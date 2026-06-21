// Движок семейного чата: WebSocket поверх надёжного хранилища (DO).
// Источник истины — сервер (монотонный seq). WS лишь ускоряет: при любом
// разрыве на (ре)коннекте hello{lastSeq} → backfill добирает всё без дыр.
// Исходящие копятся в outbox (pending) и переотправляются при готовности —
// ни одно сообщение/задача не теряется.

import { db } from '../../db/db';
import type { FamilyConfig, FamilyTask, FamilyMember } from '../../db/types';
import { encryptJSON, decryptJSON } from '../crypto';
import { getPushSubscription } from '../push';
import { getFamilyConfig, patchFamilyConfig } from './familyState';

const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';
const WS_URL = 'wss://life-hub-push.xabos161rus.workers.dev';
const RECONNECT_MS = 3000;

type ConnState = 'offline' | 'connecting' | 'online';
type Channel = 'msg' | 'task' | 'member';

let ws: WebSocket | null = null;
let state: ConnState = 'offline';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let connecting = false; // guard на фазу fetch-ticket (ws ещё null) — без гонки
let wantConnected = false;
const PING_MS = 25_000;
const listeners = new Set<(s: ConnState) => void>();

function startPing(sock: WebSocket) {
  stopPing();
  pingTimer = setInterval(() => {
    if (sock.readyState === WebSocket.OPEN) sock.send('{"t":"ping"}');
  }, PING_MS);
}
function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

// Курсор lastSeq: держим в памяти и пишем в db.family с дебаунсом — иначе
// запись на КАЖДЫЙ item бэкфилла дёргает 5 useLiveQuery-подписчиков (фриз
// входа в чат). Несвоевременный flush безопасен: при реконнекте backfill
// повторится идемпотентно (applyItem пропустит по seq).
let maxSeqSeen = 0;
let seqFlushTimer: ReturnType<typeof setTimeout> | null = null;
function bumpSeq(seq: number) {
  if (seq > maxSeqSeen) maxSeqSeen = seq;
  if (seqFlushTimer) return;
  seqFlushTimer = setTimeout(() => {
    seqFlushTimer = null;
    void getFamilyConfig().then((c) => {
      if (c && maxSeqSeen > c.lastSeq) void patchFamilyConfig({ lastSeq: maxSeqSeen });
    });
  }, 600);
}

function setState(s: ConnState) {
  if (s === state) return;
  state = s;
  listeners.forEach((l) => l(s));
}

export function connectionState(): ConnState {
  return state;
}

export function subscribeConnection(fn: (s: ConnState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

// Presence: кто из участников сейчас онлайн (по WS-соединениям в DO).
let onlineIds: string[] = [];
const presenceListeners = new Set<(ids: string[]) => void>();
function setPresence(ids: string[]) {
  onlineIds = ids;
  presenceListeners.forEach((l) => l(ids));
}
export function onlineMembers(): string[] {
  return onlineIds;
}
export function subscribePresence(fn: (ids: string[]) => void): () => void {
  presenceListeners.add(fn);
  fn(onlineIds);
  return () => presenceListeners.delete(fn);
}

// Read-receipts: до какого seq каждый участник прочитал чат.
let reads: Record<string, number> = {};
const readsListeners = new Set<(r: Record<string, number>) => void>();
function notifyReads() {
  readsListeners.forEach((l) => l(reads));
}
function setReadFor(memberId: string, seq: number) {
  if ((reads[memberId] ?? 0) >= seq) return;
  reads = { ...reads, [memberId]: seq };
  notifyReads();
}
function setAllReads(arr: { memberId: string; seq: number }[]) {
  const next = { ...reads };
  let changed = false;
  for (const r of arr) {
    if ((next[r.memberId] ?? 0) < r.seq) {
      next[r.memberId] = r.seq;
      changed = true;
    }
  }
  if (changed) {
    reads = next;
    notifyReads();
  }
}
export function subscribeReads(fn: (r: Record<string, number>) => void): () => void {
  readsListeners.add(fn);
  fn(reads);
  return () => readsListeners.delete(fn);
}

// === Применение входящих записей: всё идёт через applyBatch (одна транзакция).
// Пакетное применение бэкфилла И живого потока: расшифровка ВНЕ транзакции (crypto.subtle —
// non-Dexie await разорвал бы транзакцию), запись — в ОДНОЙ транзакции, чтобы
// useLiveQuery дёрнулся один раз, а не на каждое из сотен сообщений (фриз входа).
type RawItem = { seq: number; channel: Channel; itemId: string; senderMemberId: string | null; createdAt: string; ciphertext: string };
async function applyBatch(c: FamilyConfig, items: RawItem[]) {
  const decoded: { it: RawItem; p: Record<string, unknown> }[] = [];
  for (const it of items) {
    try {
      decoded.push({ it, p: await decryptJSON(c.familyKey, it.ciphertext) });
    } catch {
      /* чужой ключ / битый шифротекст */
    }
  }
  await db.transaction('rw', db.familyMessages, db.familyTasks, db.familyMembers, async () => {
    for (const { it, p } of decoded) {
      if (it.channel === 'msg') {
        const local = await db.familyMessages.get(it.itemId);
        if (local && local.seq != null && it.seq <= local.seq) continue;
        await db.familyMessages.put({
          clientMsgId: it.itemId,
          seq: it.seq,
          senderMemberId: it.senderMemberId ?? '',
          createdAt: it.createdAt,
          text: String(p.text ?? ''),
          status: 'acked',
          deletedAt: (p.deletedAt as string | null) ?? null,
        });
      } else if (it.channel === 'task') {
        const local = await db.familyTasks.get(it.itemId);
        if (!local || it.seq > local.seq) await db.familyTasks.put({ ...(p as unknown as FamilyTask), id: it.itemId, seq: it.seq });
      } else if (it.channel === 'member') {
        const local = await db.familyMembers.get(it.itemId);
        if (!local || it.seq > local.seq) await db.familyMembers.put({ ...(p as unknown as FamilyMember), id: it.itemId, seq: it.seq });
      }
    }
  });
  const maxSeq = items.reduce((mx, i) => Math.max(mx, i.seq), c.lastSeq);
  if (maxSeq > c.lastSeq) {
    c.lastSeq = maxSeq;
    bumpSeq(maxSeq);
  }
}

// Микро-очередь живых item: пачка пришедших за 50мс применяется одной
// транзакцией (applyBatch) → один wake liveQuery вместо N перерисовок ленты.
let itemBuf: RawItem[] = [];
let itemFlush: ReturnType<typeof setTimeout> | null = null;
function queueItem(m: RawItem) {
  itemBuf.push(m);
  if (itemFlush) return;
  itemFlush = setTimeout(() => {
    itemFlush = null;
    const batch = itemBuf;
    itemBuf = [];
    void getFamilyConfig().then((fresh) => (fresh ? applyBatch(fresh, batch) : undefined));
  }, 50);
}

// === Переотправка неподтверждённого (pending msg + task/member с seq=0) ===
async function resendOutbox() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const c = await getFamilyConfig();
  if (!c) return;
  // Неподтверждённое: pending-сообщения + task/member с seq=0 (ещё без серверного seq).
  const pendingMsgs = (await db.familyMessages.toArray()).filter((x) => x.status === 'pending');
  for (const m of pendingMsgs) {
    ws.send(JSON.stringify({
      type: 'send',
      channel: 'msg',
      clientMsgId: m.clientMsgId,
      senderMemberId: m.senderMemberId,
      createdAt: m.createdAt,
      edit: true, // при реконнекте могут быть правки/удаления — пропускаем дедуп
      ciphertext: await encryptJSON(c.familyKey, { text: m.text, deletedAt: m.deletedAt }),
    }));
  }
  for (const t of (await db.familyTasks.toArray()).filter((x) => x.seq === 0)) {
    ws.send(JSON.stringify({ type: 'send', channel: 'task', itemId: t.id, senderMemberId: c.selfMemberId, ciphertext: await encryptJSON(c.familyKey, stripMeta(t)) }));
  }
  for (const mem of (await db.familyMembers.toArray()).filter((x) => x.seq === 0)) {
    ws.send(JSON.stringify({ type: 'send', channel: 'member', itemId: mem.id, senderMemberId: c.selfMemberId, ciphertext: await encryptJSON(c.familyKey, stripMeta(mem)) }));
  }
}

function stripMeta<T extends { id: string; seq: number }>(row: T) {
  const { id, seq, ...rest } = row;
  void id;
  void seq;
  return rest;
}

// === Соединение ===
export async function connect() {
  wantConnected = true;
  if (connecting) return; // фаза fetch-ticket уже идёт — без гонки двух тикетов
  const c = await getFamilyConfig();
  if (!c || !c.enabled) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  connecting = true;
  setState('connecting');
  try {
    const tr = await fetch(`${WORKER_URL}/family/ticket?familyId=${c.familyId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.familyToken}` },
    });
    if (!tr.ok) throw new Error('ticket');
    const { ticket } = (await tr.json()) as { ticket: string };
    const sock = new WebSocket(`${WS_URL}/family/ws?familyId=${c.familyId}&ticket=${ticket}`);
    ws = sock;
    sock.onopen = () => {
      connecting = false;
      sock.send(JSON.stringify({ type: 'hello', lastSeq: c.lastSeq, memberId: c.selfMemberId }));
    };
    sock.onmessage = async (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.t === 'pong') return; // ответ на heartbeat
      if (m.type === 'backfill') {
        const fresh = await getFamilyConfig();
        if (fresh && m.items?.length) await applyBatch(fresh, m.items);
      } else if (m.type === 'ready') {
        setState('online');
        if (Array.isArray(m.online)) setPresence(m.online);
        if (Array.isArray(m.reads)) setAllReads(m.reads);
        if (m.name) void patchFamilyConfig({ familyName: String(m.name) });
        startPing(sock);
        await resendOutbox();
        await registerPush(c);
      } else if (m.type === 'presence') {
        setPresence(Array.isArray(m.online) ? m.online : []);
      } else if (m.type === 'name') {
        void patchFamilyConfig({ familyName: String(m.name ?? '') });
      } else if (m.type === 'read') {
        if (m.memberId && typeof m.seq === 'number') setReadFor(m.memberId, m.seq);
      } else if (m.type === 'item') {
        queueItem(m); // батчим — пачка item за 50мс применяется одной транзакцией
      } else if (m.type === 'ack' && m.clientMsgId) {
        await db.familyMessages.update(m.clientMsgId, { status: 'acked', seq: m.seq });
      }
    };
    sock.onclose = () => {
      ws = null;
      connecting = false;
      stopPing();
      setPresence([]);
      setState('offline');
      scheduleReconnect();
    };
    sock.onerror = () => sock.close();
  } catch {
    connecting = false;
    setState('offline');
    scheduleReconnect();
  }
}

/** Зарегистрировать push-подписку этого устройства в семье (после включения
 *  уведомлений), не дожидаясь следующего WS-ready. */
export async function registerFamilyPush(): Promise<void> {
  const c = await getFamilyConfig();
  if (c) await registerPush(c);
}

// Регистрируем push-подписку этого участника в DO — чтобы получать
// уведомления о сообщениях, когда приложение закрыто (WS мёртв).
async function registerPush(c: FamilyConfig) {
  const sub = getPushSubscription();
  if (!sub) return;
  try {
    await fetch(`${WORKER_URL}/family/push-sub?familyId=${c.familyId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.familyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: c.selfMemberId, subscription: sub }),
    });
  } catch {
    /* офлайн — переедет при следующем ready */
  }
}

function scheduleReconnect() {
  if (!wantConnected || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, RECONNECT_MS);
}

export function disconnect() {
  wantConnected = false;
  connecting = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopPing();
  setPresence([]);
  ws?.close();
  ws = null;
  setState('offline');
}

// === Отправка ===
function trySendFrame(frame: object) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  // иначе оставляем в БД — уйдёт на ближайшем ready через resendOutbox
}

/** Отправить сообщение в чат. Сначала пишем локально (pending), потом по сети. */
export async function sendMessage(text: string): Promise<void> {
  const body = text.trim();
  if (!body) return;
  const c = await getFamilyConfig();
  if (!c) return;
  const clientMsgId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.familyMessages.put({ clientMsgId, seq: null, senderMemberId: c.selfMemberId, createdAt, text: body, status: 'pending', deletedAt: null });
  trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: c.selfMemberId, createdAt, ciphertext: await encryptJSON(c.familyKey, { text: body, deletedAt: null }) });
  if (!ws || ws.readyState !== WebSocket.OPEN) void connect();
}

/** Редактировать сообщение (любой участник). Новая версия побеждает по seq. */
export async function editMessage(clientMsgId: string, newText: string): Promise<void> {
  const text = newText.trim();
  if (!text) return;
  const c = await getFamilyConfig();
  if (!c) return;
  const m = await db.familyMessages.get(clientMsgId);
  if (!m) return;
  await db.familyMessages.update(clientMsgId, { text, status: 'pending', seq: null });
  const ciphertext = await encryptJSON(c.familyKey, { text, deletedAt: m.deletedAt ?? null });
  trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: m.senderMemberId, createdAt: m.createdAt, edit: true, ciphertext });
  if (!ws || ws.readyState !== WebSocket.OPEN) void connect();
}

/** Удалить сообщение (любой участник). Мягкое удаление, разъезжается по seq. */
export async function deleteMessage(clientMsgId: string): Promise<void> {
  const c = await getFamilyConfig();
  if (!c) return;
  const m = await db.familyMessages.get(clientMsgId);
  if (!m) return;
  const deletedAt = new Date().toISOString();
  await db.familyMessages.update(clientMsgId, { deletedAt, status: 'pending', seq: null });
  const ciphertext = await encryptJSON(c.familyKey, { text: m.text, deletedAt });
  trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: m.senderMemberId, createdAt: m.createdAt, edit: true, ciphertext });
  if (!ws || ws.readyState !== WebSocket.OPEN) void connect();
}

/** Переименовать семью (общее имя группы — синкается всем участникам). */
export async function renameFamily(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const c = await getFamilyConfig();
  if (!c) return;
  await patchFamilyConfig({ familyName: trimmed }); // оптимистично
  trySendFrame({ type: 'rename', name: trimmed });
  if (!ws || ws.readyState !== WebSocket.OPEN) void connect();
}

/** Отметить, что прочитаны сообщения до seq (отправляет read-receipt). */
export function markSeen(seq: number): void {
  if (seq > 0) trySendFrame({ type: 'seen', seq });
}

/** Отправить семейную запись (задача/участник). Локально seq=0 до подтверждения. */
export async function sendItem(channel: 'task' | 'member', itemId: string, payload: object): Promise<void> {
  const c = await getFamilyConfig();
  if (!c) return;
  trySendFrame({ type: 'send', channel, itemId, senderMemberId: c.selfMemberId, ciphertext: await encryptJSON(c.familyKey, payload) });
  if (!ws || ws.readyState !== WebSocket.OPEN) void connect();
}
