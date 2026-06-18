// Движок семейного чата: WebSocket поверх надёжного хранилища (DO).
// Источник истины — сервер (монотонный seq). WS лишь ускоряет: при любом
// разрыве на (ре)коннекте hello{lastSeq} → backfill добирает всё без дыр.
// Исходящие копятся в outbox (pending) и переотправляются при готовности —
// ни одно сообщение/задача не теряется.

import { db } from '../../db/db';
import type { FamilyConfig, FamilyTask, FamilyMember } from '../../db/types';
import { encryptJSON, decryptJSON } from '../crypto';
import { getFamilyConfig, patchFamilyConfig } from './familyState';

const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';
const WS_URL = 'wss://life-hub-push.xabos161rus.workers.dev';
const RECONNECT_MS = 3000;

type ConnState = 'offline' | 'connecting' | 'online';
type Channel = 'msg' | 'task' | 'member';

let ws: WebSocket | null = null;
let state: ConnState = 'offline';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wantConnected = false;
const listeners = new Set<(s: ConnState) => void>();

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

// === Применение входящих записей (по channel, LWW по seq) ===
async function applyItem(c: FamilyConfig, item: {
  seq: number;
  channel: Channel;
  itemId: string;
  senderMemberId: string | null;
  createdAt: string;
  ciphertext: string;
}) {
  let payload: Record<string, unknown>;
  try {
    payload = await decryptJSON(c.familyKey, item.ciphertext);
  } catch {
    return; // чужой ключ / битый шифротекст — пропускаем
  }
  if (item.channel === 'msg') {
    await db.familyMessages.put({
      clientMsgId: item.itemId,
      seq: item.seq,
      senderMemberId: item.senderMemberId ?? '',
      createdAt: item.createdAt,
      text: String(payload.text ?? ''),
      status: 'acked',
      deletedAt: (payload.deletedAt as string | null) ?? null,
    });
  } else if (item.channel === 'task') {
    const local = await db.familyTasks.get(item.itemId);
    if (!local || item.seq > local.seq) {
      await db.familyTasks.put({ ...(payload as unknown as FamilyTask), id: item.itemId, seq: item.seq });
    }
  } else if (item.channel === 'member') {
    const local = await db.familyMembers.get(item.itemId);
    if (!local || item.seq > local.seq) {
      await db.familyMembers.put({ ...(payload as unknown as FamilyMember), id: item.itemId, seq: item.seq });
    }
  }
  if (item.seq > c.lastSeq) {
    c.lastSeq = item.seq;
    await patchFamilyConfig({ lastSeq: item.seq });
  }
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
  const c = await getFamilyConfig();
  if (!c || !c.enabled) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
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
      sock.send(JSON.stringify({ type: 'hello', lastSeq: c.lastSeq, memberId: c.selfMemberId }));
    };
    sock.onmessage = async (ev) => {
      const m = JSON.parse(ev.data as string);
      if (m.type === 'backfill') {
        const fresh = await getFamilyConfig();
        if (fresh) for (const it of m.items) await applyItem(fresh, it);
      } else if (m.type === 'ready') {
        setState('online');
        await resendOutbox();
      } else if (m.type === 'item') {
        const fresh = await getFamilyConfig();
        if (fresh) await applyItem(fresh, m);
      } else if (m.type === 'ack' && m.clientMsgId) {
        await db.familyMessages.update(m.clientMsgId, { status: 'acked', seq: m.seq });
      }
    };
    sock.onclose = () => {
      ws = null;
      setState('offline');
      scheduleReconnect();
    };
    sock.onerror = () => sock.close();
  } catch {
    setState('offline');
    scheduleReconnect();
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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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

/** Отправить семейную запись (задача/участник). Локально seq=0 до подтверждения. */
export async function sendItem(channel: 'task' | 'member', itemId: string, payload: object): Promise<void> {
  const c = await getFamilyConfig();
  if (!c) return;
  trySendFrame({ type: 'send', channel, itemId, senderMemberId: c.selfMemberId, ciphertext: await encryptJSON(c.familyKey, payload) });
  if (!ws || ws.readyState !== WebSocket.OPEN) void connect();
}
