// Движок семейного чата: WebSocket поверх надёжного хранилища (DO).
// Источник истины — сервер (монотонный seq). WS лишь ускоряет: при любом
// разрыве на (ре)коннекте hello{lastSeq} → backfill добирает всё без дыр.
// Исходящие копятся в outbox (pending) и переотправляются при готовности.
//
// МНОГОГРУППОВОСТЬ: на каждую семью (familyId) — свой экземпляр FamilyEngine
// (своё соединение, курсор, presence, reads). Реестр engines держит их все
// живыми одновременно — две группы синкаются и шлют пуши параллельно.

import { db } from '../../db/db';
import type { FamilyConfig, FamilyTask, FamilyMember } from '../../db/types';
import { encryptJSON, decryptJSON } from '../crypto';
import { getPushSubscription } from '../push';
import { getFamilyConfig, patchFamilyConfig, listFamilyConfigs } from './familyState';

const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';
const WS_URL = 'wss://life-hub-push.xabos161rus.workers.dev';
const RECONNECT_MS = 3000;
const PING_MS = 25_000;

type ConnState = 'offline' | 'connecting' | 'online';
type Channel = 'msg' | 'task' | 'member';

// Сигнал звонка (WebRTC): эфемерный, проходит через WS, в БД не пишется.
export type SignalKind = 'offer' | 'answer' | 'ice' | 'decline' | 'hangup' | 'busy' | 'cancel';
export interface SignalFrame {
  from: string | null;
  to: string | null;
  call: string | null;
  kind: SignalKind;
  data: string | null; // шифротекст SDP/ICE (семейный ключ)
}
type RawItem = { seq: number; channel: Channel; itemId: string; senderMemberId: string | null; createdAt: string; ciphertext: string };

function stripMeta<T extends { id: string; seq: number; familyId?: string }>(row: T) {
  const { id, seq, familyId, ...rest } = row;
  void id;
  void seq;
  void familyId;
  return rest;
}

// === Один экземпляр на семью ===
class FamilyEngine {
  readonly familyId: string;
  private ws: WebSocket | null = null;
  private state: ConnState = 'offline';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connecting = false; // фаза fetch-ticket (ws ещё null) — guard от гонки
  private wantConnected = false;

  // Курсор lastSeq: держим в памяти, пишем в db.family с дебаунсом — иначе
  // запись на КАЖДЫЙ item бэкфилла дёргает useLiveQuery-подписчиков (фриз).
  private maxSeqSeen = 0;
  private seqFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private onlineIds: string[] = [];
  private reads: Record<string, number> = {};
  private lastReadSeqMem = 0;

  private itemBuf: RawItem[] = [];
  private itemFlush: ReturnType<typeof setTimeout> | null = null;

  private connListeners = new Set<(s: ConnState) => void>();
  private presenceListeners = new Set<(ids: string[]) => void>();
  private readsListeners = new Set<(r: Record<string, number>) => void>();
  private signalListeners = new Set<(f: SignalFrame) => void>();
  private lastSeen: Record<string, string> = {}; // memberId → ISO последнего выхода из сети
  private lastSeenListeners = new Set<(m: Record<string, string>) => void>();

  constructor(familyId: string) {
    this.familyId = familyId;
  }

  private cfg() {
    return getFamilyConfig(this.familyId);
  }

  // --- подписки/геттеры ---
  connectionState(): ConnState {
    return this.state;
  }
  subscribeConnection(fn: (s: ConnState) => void): () => void {
    this.connListeners.add(fn);
    fn(this.state);
    return () => this.connListeners.delete(fn);
  }
  onlineMembers(): string[] {
    return this.onlineIds;
  }
  subscribePresence(fn: (ids: string[]) => void): () => void {
    this.presenceListeners.add(fn);
    fn(this.onlineIds);
    return () => this.presenceListeners.delete(fn);
  }
  subscribeReads(fn: (r: Record<string, number>) => void): () => void {
    this.readsListeners.add(fn);
    fn(this.reads);
    return () => this.readsListeners.delete(fn);
  }
  subscribeSignals(fn: (f: SignalFrame) => void): () => void {
    this.signalListeners.add(fn);
    return () => this.signalListeners.delete(fn);
  }
  subscribeLastSeen(fn: (m: Record<string, string>) => void): () => void {
    this.lastSeenListeners.add(fn);
    fn(this.lastSeen);
    return () => this.lastSeenListeners.delete(fn);
  }
  /** Отправить сигнал звонка адресату (to = memberId). */
  sendSignal(frame: { to: string; call: string; kind: SignalKind; data: string | null }): void {
    this.trySendFrame({ type: 'signal', ...frame });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  private setState(s: ConnState) {
    if (s === this.state) return;
    this.state = s;
    this.connListeners.forEach((l) => l(s));
  }
  private setPresence(ids: string[]) {
    this.onlineIds = ids;
    this.presenceListeners.forEach((l) => l(ids));
  }
  private setLastSeen(map: unknown) {
    if (!map || typeof map !== 'object') return;
    this.lastSeen = { ...this.lastSeen, ...(map as Record<string, string>) };
    this.lastSeenListeners.forEach((l) => l(this.lastSeen));
  }
  private notifyReads() {
    this.readsListeners.forEach((l) => l(this.reads));
  }
  private setReadFor(memberId: string, seq: number) {
    if ((this.reads[memberId] ?? 0) >= seq) return;
    this.reads = { ...this.reads, [memberId]: seq };
    this.notifyReads();
  }
  private setAllReads(arr: { memberId: string; seq: number }[]) {
    const next = { ...this.reads };
    let changed = false;
    for (const r of arr) {
      if ((next[r.memberId] ?? 0) < r.seq) {
        next[r.memberId] = r.seq;
        changed = true;
      }
    }
    if (changed) {
      this.reads = next;
      this.notifyReads();
    }
  }

  private startPing(sock: WebSocket) {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (sock.readyState === WebSocket.OPEN) sock.send('{"t":"ping"}');
    }, PING_MS);
  }
  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private bumpSeq(seq: number) {
    if (seq > this.maxSeqSeen) this.maxSeqSeen = seq;
    if (this.seqFlushTimer) return;
    this.seqFlushTimer = setTimeout(() => {
      this.seqFlushTimer = null;
      void this.cfg().then((c) => {
        if (c && this.maxSeqSeen > c.lastSeq) void patchFamilyConfig(this.familyId, { lastSeq: this.maxSeqSeen });
      });
    }, 600);
  }

  // Пакетное применение бэкфилла И живого потока: расшифровка ВНЕ транзакции,
  // запись — в ОДНОЙ транзакции (один wake useLiveQuery вместо сотен).
  private async applyBatch(c: FamilyConfig, items: RawItem[]) {
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
            familyId: this.familyId,
            seq: it.seq,
            senderMemberId: it.senderMemberId ?? '',
            createdAt: it.createdAt,
            text: String(p.text ?? ''),
            image: (p.image as string | null) ?? null,
            audio: (p.audio as string | null) ?? null,
            audioDur: typeof p.audioDur === 'number' ? p.audioDur : undefined,
            system: Boolean(p.system),
            status: 'acked',
            deletedAt: (p.deletedAt as string | null) ?? null,
          });
        } else if (it.channel === 'task') {
          const local = await db.familyTasks.get(it.itemId);
          if (!local || it.seq > local.seq) await db.familyTasks.put({ ...(p as unknown as FamilyTask), id: it.itemId, familyId: this.familyId, seq: it.seq });
        } else if (it.channel === 'member') {
          const local = await db.familyMembers.get(it.itemId);
          if (!local || it.seq > local.seq) await db.familyMembers.put({ ...(p as unknown as FamilyMember), id: it.itemId, familyId: this.familyId, seq: it.seq });
        }
      }
    });
    const maxSeq = items.reduce((mx, i) => Math.max(mx, i.seq), c.lastSeq);
    if (maxSeq > c.lastSeq) {
      c.lastSeq = maxSeq;
      this.bumpSeq(maxSeq);
    }
  }

  // Микро-очередь живых item: пачка за 50мс применяется одной транзакцией.
  private queueItem(m: RawItem) {
    this.itemBuf.push(m);
    if (this.itemFlush) return;
    this.itemFlush = setTimeout(() => {
      this.itemFlush = null;
      const batch = this.itemBuf;
      this.itemBuf = [];
      void this.cfg().then((fresh) => (fresh ? this.applyBatch(fresh, batch) : undefined));
    }, 50);
  }

  // Переотправка неподтверждённого (pending msg + task/member с seq=0).
  private async resendOutbox() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const c = await this.cfg();
    if (!c) return;
    const all = await db.familyMessages.where('familyId').equals(this.familyId).toArray();
    for (const m of all.filter((x) => x.status === 'pending')) {
      this.ws.send(JSON.stringify({
        type: 'send',
        channel: 'msg',
        clientMsgId: m.clientMsgId,
        senderMemberId: m.senderMemberId,
        createdAt: m.createdAt,
        edit: true, // при реконнекте могут быть правки/удаления — пропускаем дедуп
        ciphertext: await encryptJSON(c.familyKey, { text: m.text, deletedAt: m.deletedAt, image: m.image ?? null, audio: m.audio ?? null, audioDur: m.audioDur, system: m.system ?? false }),
      }));
    }
    for (const t of (await db.familyTasks.where('familyId').equals(this.familyId).toArray()).filter((x) => x.seq === 0)) {
      this.ws.send(JSON.stringify({ type: 'send', channel: 'task', itemId: t.id, senderMemberId: c.selfMemberId, ciphertext: await encryptJSON(c.familyKey, stripMeta(t)) }));
    }
    for (const mem of (await db.familyMembers.where('familyId').equals(this.familyId).toArray()).filter((x) => x.seq === 0)) {
      this.ws.send(JSON.stringify({ type: 'send', channel: 'member', itemId: mem.id, senderMemberId: c.selfMemberId, ciphertext: await encryptJSON(c.familyKey, stripMeta(mem)) }));
    }
  }

  async connect() {
    this.wantConnected = true;
    // Guard выставляем СИНХРОННО (до любого await): иначе два почти
    // одновременных connect() (visibilitychange+focus при возврате в PWA) оба
    // пройдут проверку и откроют по сокету на одну группу.
    if (this.connecting) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.connecting = true;
    this.setState('connecting');
    try {
      const c = await this.cfg();
      // Движок мог быть снят с реестра (выход/выключение группы), пока читали
      // конфиг. Если так — НЕ открываем сокет: его некому будет закрыть
      // (getEngine создаст новый экземпляр), а зомби писал бы бэкфилл в только
      // что очищенную группу. engines.get(...)===this — инвариант «я актуальный».
      if (!c || !c.enabled || !this.wantConnected || engines.get(this.familyId) !== this) {
        this.connecting = false;
        this.setState('offline');
        return;
      }
      this.lastReadSeqMem = Math.max(this.lastReadSeqMem, c.lastReadSeq ?? 0);
      const tr = await fetch(`${WORKER_URL}/family/ticket?familyId=${c.familyId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.familyToken}` },
      });
      if (!tr.ok) throw new Error('ticket');
      const { ticket } = (await tr.json()) as { ticket: string };
      // Ещё раз после сетевой задержки тикета — окно, в котором мог случиться leave.
      if (!this.wantConnected || engines.get(this.familyId) !== this) {
        this.connecting = false;
        this.setState('offline');
        return;
      }
      const sock = new WebSocket(`${WS_URL}/family/ws?familyId=${c.familyId}&ticket=${ticket}`);
      this.ws = sock;
      sock.onopen = () => {
        if (this.ws !== sock) return; // нас уже заменили — этот сокет осиротел
        this.connecting = false;
        sock.send(JSON.stringify({ type: 'hello', lastSeq: c.lastSeq, memberId: c.selfMemberId }));
      };
      sock.onmessage = async (ev) => {
        if (this.ws !== sock) return; // событие осиротевшего сокета — игнор
        const m = JSON.parse(ev.data as string);
        if (m.t === 'pong') return; // ответ на heartbeat
        if (m.type === 'backfill') {
          const fresh = await this.cfg();
          if (fresh && m.items?.length) await this.applyBatch(fresh, m.items);
        } else if (m.type === 'ready') {
          this.setState('online');
          if (Array.isArray(m.online)) this.setPresence(m.online);
          this.setLastSeen(m.lastSeen);
          if (Array.isArray(m.reads)) this.setAllReads(m.reads);
          if (m.name) void patchFamilyConfig(this.familyId, { familyName: String(m.name) });
          this.startPing(sock);
          await this.resendOutbox();
          await this.registerPush(c);
        } else if (m.type === 'presence') {
          this.setPresence(Array.isArray(m.online) ? m.online : []);
          this.setLastSeen(m.lastSeen);
        } else if (m.type === 'name') {
          void patchFamilyConfig(this.familyId, { familyName: String(m.name ?? '') });
        } else if (m.type === 'read') {
          if (m.memberId && typeof m.seq === 'number') this.setReadFor(m.memberId, m.seq);
        } else if (m.type === 'item') {
          this.queueItem(m); // батчим — пачка item за 50мс применяется одной транзакцией
        } else if (m.type === 'ack' && m.clientMsgId) {
          await db.familyMessages.update(m.clientMsgId, { status: 'acked', seq: m.seq });
        } else if (m.type === 'signal') {
          this.signalListeners.forEach((l) => l(m as SignalFrame));
        }
      };
      sock.onclose = () => {
        if (this.ws !== sock) return; // закрылся осиротевший сокет — актуальный не трогаем
        this.ws = null;
        this.connecting = false;
        this.stopPing();
        this.setPresence([]);
        this.setState('offline');
        this.scheduleReconnect();
      };
      sock.onerror = () => sock.close();
    } catch {
      this.connecting = false;
      this.setState('offline');
      this.scheduleReconnect();
    }
  }

  // Регистрируем push-подписку этого участника в DO — чтобы получать
  // уведомления о сообщениях, когда приложение закрыто (WS мёртв).
  async registerPush(c?: FamilyConfig) {
    const cfg = c ?? (await this.cfg());
    if (!cfg) return;
    const sub = getPushSubscription();
    if (!sub) return;
    try {
      await fetch(`${WORKER_URL}/family/push-sub?familyId=${cfg.familyId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.familyToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: cfg.selfMemberId, subscription: sub }),
      });
    } catch {
      /* офлайн — переедет при следующем ready */
    }
  }

  private scheduleReconnect() {
    if (!this.wantConnected || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_MS);
  }

  disconnect() {
    this.wantConnected = false;
    this.connecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    this.setPresence([]);
    this.ws?.close();
    this.ws = null;
    this.setState('offline');
  }

  private trySendFrame(frame: object) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame));
    // иначе оставляем в БД — уйдёт на ближайшем ready через resendOutbox
  }

  async sendMessage(text: string): Promise<void> {
    const body = text.trim();
    if (!body) return;
    const c = await this.cfg();
    if (!c) return;
    const clientMsgId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.familyMessages.put({ clientMsgId, familyId: this.familyId, seq: null, senderMemberId: c.selfMemberId, createdAt, text: body, status: 'pending', deletedAt: null });
    this.trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: c.selfMemberId, createdAt, ciphertext: await encryptJSON(c.familyKey, { text: body, deletedAt: null }) });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  async editMessage(clientMsgId: string, newText: string): Promise<void> {
    const text = newText.trim();
    if (!text) return;
    const c = await this.cfg();
    if (!c) return;
    const m = await db.familyMessages.get(clientMsgId);
    if (!m) return;
    await db.familyMessages.update(clientMsgId, { text, status: 'pending', seq: null });
    const ciphertext = await encryptJSON(c.familyKey, { text, deletedAt: m.deletedAt ?? null, image: m.image ?? null, audio: m.audio ?? null, audioDur: m.audioDur, system: m.system ?? false });
    this.trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: m.senderMemberId, createdAt: m.createdAt, edit: true, ciphertext });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  async deleteMessage(clientMsgId: string): Promise<void> {
    const c = await this.cfg();
    if (!c) return;
    const m = await db.familyMessages.get(clientMsgId);
    if (!m) return;
    const deletedAt = new Date().toISOString();
    await db.familyMessages.update(clientMsgId, { deletedAt, status: 'pending', seq: null });
    const ciphertext = await encryptJSON(c.familyKey, { text: m.text, deletedAt, image: m.image ?? null, audio: m.audio ?? null, audioDur: m.audioDur, system: m.system ?? false });
    this.trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: m.senderMemberId, createdAt: m.createdAt, edit: true, ciphertext });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  /** Отправить картинку (сжатый JPEG dataURL) как сообщение-картинку. */
  async sendImage(dataUrl: string): Promise<void> {
    const c = await this.cfg();
    if (!c) return;
    const clientMsgId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.familyMessages.put({ clientMsgId, familyId: this.familyId, seq: null, senderMemberId: c.selfMemberId, createdAt, text: '', image: dataUrl, status: 'pending', deletedAt: null });
    this.trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: c.selfMemberId, createdAt, ciphertext: await encryptJSON(c.familyKey, { text: '', deletedAt: null, image: dataUrl }) });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  /** Отправить голосовое сообщение (аудио dataURL + длительность, сек). */
  async sendAudio(dataUrl: string, durationSec: number): Promise<void> {
    const c = await this.cfg();
    if (!c) return;
    const clientMsgId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.familyMessages.put({ clientMsgId, familyId: this.familyId, seq: null, senderMemberId: c.selfMemberId, createdAt, text: '', audio: dataUrl, audioDur: durationSec, status: 'pending', deletedAt: null });
    this.trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: c.selfMemberId, createdAt, ciphertext: await encryptJSON(c.familyKey, { text: '', deletedAt: null, audio: dataUrl, audioDur: durationSec }) });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  /** Системное сообщение (например, «X присоединился») — по центру, без пузыря. */
  async sendSystemMessage(text: string): Promise<void> {
    const body = text.trim();
    if (!body) return;
    const c = await this.cfg();
    if (!c) return;
    const clientMsgId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.familyMessages.put({ clientMsgId, familyId: this.familyId, seq: null, senderMemberId: c.selfMemberId, createdAt, text: body, system: true, status: 'pending', deletedAt: null });
    this.trySendFrame({ type: 'send', channel: 'msg', clientMsgId, senderMemberId: c.selfMemberId, createdAt, ciphertext: await encryptJSON(c.familyKey, { text: body, deletedAt: null, system: true }) });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  async renameFamily(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const c = await this.cfg();
    if (!c) return;
    await patchFamilyConfig(this.familyId, { familyName: trimmed }); // оптимистично
    this.trySendFrame({ type: 'rename', name: trimmed });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }

  markSeen(seq: number): void {
    if (seq <= 0) return;
    this.trySendFrame({ type: 'seen', seq });
    if (seq > this.lastReadSeqMem) {
      this.lastReadSeqMem = seq;
      void patchFamilyConfig(this.familyId, { lastReadSeq: seq });
    }
  }

  async sendItem(channel: 'task' | 'member', itemId: string, payload: object): Promise<void> {
    const c = await this.cfg();
    if (!c) return;
    this.trySendFrame({ type: 'send', channel, itemId, senderMemberId: c.selfMemberId, ciphertext: await encryptJSON(c.familyKey, payload) });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) void this.connect();
  }
}

// === Реестр движков (по одному на семью) ===
const engines = new Map<string, FamilyEngine>();
function getEngine(familyId: string): FamilyEngine {
  let e = engines.get(familyId);
  if (!e) {
    e = new FamilyEngine(familyId);
    engines.set(familyId, e);
  }
  return e;
}

/** Поднять/синхронизировать соединения для ВСЕХ включённых групп. Снимает
 *  движки исчезнувших групп, поднимает новые. Идемпотентно. */
export async function connectAllFamilies(): Promise<void> {
  const cfgs = await listFamilyConfigs();
  const enabled = new Set(cfgs.filter((c) => c.enabled).map((c) => c.familyId));
  for (const [fid, e] of engines) {
    if (!enabled.has(fid)) {
      e.disconnect();
      engines.delete(fid);
    }
  }
  for (const fid of enabled) void getEngine(fid).connect();
}

export function disconnectAllFamilies(): void {
  for (const [, e] of engines) e.disconnect();
  engines.clear();
}

/** Зарегистрировать push-подписку этого устройства во ВСЕХ группах (после
 *  включения уведомлений), не дожидаясь следующего WS-ready по каждой. */
export async function registerAllFamilyPush(): Promise<void> {
  const cfgs = await listFamilyConfigs();
  for (const c of cfgs.filter((x) => x.enabled)) await getEngine(c.familyId).registerPush(c);
}

// --- Тонкие обёртки по familyId (UI работает с конкретной группой) ---
export function connectFamily(familyId: string): void {
  void getEngine(familyId).connect();
}
export function disconnectFamily(familyId: string): void {
  const e = engines.get(familyId);
  if (e) {
    e.disconnect();
    engines.delete(familyId);
  }
}
export function connectionState(familyId: string) {
  return getEngine(familyId).connectionState();
}
export function subscribeConnection(familyId: string, fn: (s: ConnState) => void): () => void {
  return getEngine(familyId).subscribeConnection(fn);
}
export function onlineMembers(familyId: string): string[] {
  return getEngine(familyId).onlineMembers();
}
export function subscribePresence(familyId: string, fn: (ids: string[]) => void): () => void {
  return getEngine(familyId).subscribePresence(fn);
}
export function subscribeReads(familyId: string, fn: (r: Record<string, number>) => void): () => void {
  return getEngine(familyId).subscribeReads(fn);
}
export function subscribeLastSeen(familyId: string, fn: (m: Record<string, string>) => void): () => void {
  return getEngine(familyId).subscribeLastSeen(fn);
}
export function sendMessage(familyId: string, text: string): Promise<void> {
  return getEngine(familyId).sendMessage(text);
}
export function sendImage(familyId: string, dataUrl: string): Promise<void> {
  return getEngine(familyId).sendImage(dataUrl);
}
export function sendAudio(familyId: string, dataUrl: string, durationSec: number): Promise<void> {
  return getEngine(familyId).sendAudio(dataUrl, durationSec);
}
export function sendSystemMessage(familyId: string, text: string): Promise<void> {
  return getEngine(familyId).sendSystemMessage(text);
}
export function editMessage(familyId: string, clientMsgId: string, newText: string): Promise<void> {
  return getEngine(familyId).editMessage(clientMsgId, newText);
}
export function deleteMessage(familyId: string, clientMsgId: string): Promise<void> {
  return getEngine(familyId).deleteMessage(clientMsgId);
}
export function renameFamily(familyId: string, name: string): Promise<void> {
  return getEngine(familyId).renameFamily(name);
}
export function markSeen(familyId: string, seq: number): void {
  getEngine(familyId).markSeen(seq);
}
export function sendItem(familyId: string, channel: 'task' | 'member', itemId: string, payload: object): Promise<void> {
  return getEngine(familyId).sendItem(channel, itemId, payload);
}
export function subscribeSignals(familyId: string, fn: (f: SignalFrame) => void): () => void {
  return getEngine(familyId).subscribeSignals(fn);
}
export function sendSignal(
  familyId: string,
  frame: { to: string; call: string; kind: SignalKind; data: string | null },
): void {
  getEngine(familyId).sendSignal(frame);
}
