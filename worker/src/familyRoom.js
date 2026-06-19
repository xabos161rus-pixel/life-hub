// FamilyRoom — Durable Object: одна комната на семью. Источник истины для
// семейных данных (чат + задачи + профили). DO видит ТОЛЬКО шифротекст —
// содержимое зашифровано общим семейным ключом на устройствах.
//
// Надёжность: каждая запись получает монотонный seq (AUTOINCREMENT) ДО рассылки.
// WebSocket — лишь ускоритель; при разрыве клиент догружает всё since lastSeq
// (backfill) — ни одно сообщение/задача не теряется. Каналы 'msg'|'member'|'task'
// в одном seq-потоке. Для msg дедуп по client_msg_id (exactly-once в БД).

import { DurableObject } from 'cloudflare:workers';
import { buildPushRequest } from './webpush.js';

const TICKET_TTL_MS = 30_000;
const BACKFILL_PAGE = 500;
const MSG_RETENTION_DAYS = 180;
const MSG_RETENTION_MAX = 5000;
const PRUNE_EVERY = 50; // прунить раз в N вставок сообщений

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class FamilyRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS items (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        item_id TEXT NOT NULL,
        client_msg_id TEXT,
        sender_member_id TEXT,
        created_at TEXT,
        ciphertext TEXT NOT NULL,
        UNIQUE(channel, item_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_cmid ON items(client_msg_id) WHERE client_msg_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS members (
        member_id TEXT PRIMARY KEY,
        push_sub TEXT,
        last_seen_seq INTEGER DEFAULT 0,
        joined_at TEXT
      );
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
    this.insertsSincePrune = 0;
  }

  // === Авторизация семейным токеном (TOFU, как личный authAccount) ===
  async checkToken(token) {
    if (!token) return false;
    const hash = await sha256hex(token);
    const row = this.sql.exec('SELECT v FROM meta WHERE k=?', 'token_hash').toArray()[0];
    if (!row) {
      this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?)', 'token_hash', hash);
      return true;
    }
    return row.v === hash;
  }

  json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token') || '';

    // WebSocket upgrade — проверяем одноразовый тикет (браузерный WS не шлёт заголовки)
    if (path.endsWith('/ws')) {
      const ticket = url.searchParams.get('ticket');
      if (!ticket || !this.consumeTicket(ticket)) return new Response('unauthorized', { status: 401 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Остальное — Bearer-токен
    if (!(await this.checkToken(token))) return this.json({ error: 'unauthorized' }, 401);

    if (path.endsWith('/ticket') && request.method === 'POST') {
      const ticket = crypto.randomUUID();
      this.sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', `ticket:${ticket}`, String(Date.now() + TICKET_TTL_MS));
      return this.json({ ticket });
    }

    if (path.endsWith('/messages') && request.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const page = this.backfill(since);
      return this.json(page);
    }

    if (path.endsWith('/send') && request.method === 'POST') {
      const body = await request.json();
      const res = await this.ingest(body);
      return this.json(res);
    }

    if (path.endsWith('/push-sub') && request.method === 'POST') {
      const { memberId, subscription } = await request.json();
      if (memberId) {
        this.sql.exec(
          'INSERT INTO members (member_id, push_sub, joined_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET push_sub=excluded.push_sub',
          memberId,
          JSON.stringify(subscription),
          new Date().toISOString(),
        );
      }
      return this.json({ ok: true });
    }

    return this.json({ error: 'not found' }, 404);
  }

  consumeTicket(ticket) {
    const key = `ticket:${ticket}`;
    const row = this.sql.exec('SELECT v FROM meta WHERE k=?', key).toArray()[0];
    if (!row) return false;
    this.sql.exec('DELETE FROM meta WHERE k=?', key); // одноразовый
    return Number(row.v) > Date.now();
  }

  // === Запись (идемпотентная по client_msg_id для msg; новый seq для версии task/member) ===
  async ingest({ channel, itemId, clientMsgId, senderMemberId, createdAt, ciphertext, edit }) {
    if (!channel || !ciphertext || (channel === 'msg' && !clientMsgId) || (channel !== 'msg' && !itemId)) {
      return { error: 'bad request' };
    }
    const id = channel === 'msg' ? clientMsgId : itemId;
    const created = createdAt || new Date().toISOString();

    // Дедуп ретрая ОТПРАВКИ (не редактирования): тот же client_msg_id и !edit →
    // вернуть исходный seq. edit=true пропускает дедуп → правка/удаление получают
    // новый seq (новая версия побеждает по seq на клиентах).
    if (channel === 'msg' && !edit) {
      const dup = this.sql.exec('SELECT seq FROM items WHERE client_msg_id=?', clientMsgId).toArray()[0];
      if (dup) return { seq: dup.seq, channel, itemId: id, clientMsgId, duplicate: true };
    }
    // task/member мутируемы: новая версия = новый seq, старая строка по item_id заменяется.
    this.sql.exec('DELETE FROM items WHERE channel=? AND item_id=?', channel, id);
    this.sql.exec(
      'INSERT INTO items (channel, item_id, client_msg_id, sender_member_id, created_at, ciphertext) VALUES (?,?,?,?,?,?)',
      channel,
      id,
      channel === 'msg' ? clientMsgId : null,
      senderMemberId || null,
      created,
      ciphertext,
    );
    const seq = this.sql.exec('SELECT last_insert_rowid() AS s').toArray()[0].s;
    const item = { seq, channel, itemId: id, clientMsgId: clientMsgId || null, senderMemberId: senderMemberId || null, createdAt: created, ciphertext };

    this.broadcast(item);
    if (channel === 'msg') {
      this.ctx.waitUntil(this.pushOffline(item, senderMemberId));
      if (++this.insertsSincePrune >= PRUNE_EVERY) {
        this.insertsSincePrune = 0;
        this.prune();
      }
    }
    return { seq, channel, itemId: id, clientMsgId: clientMsgId || null };
  }

  backfill(since) {
    const rows = this.sql
      .exec(
        'SELECT seq, channel, item_id, client_msg_id, sender_member_id, created_at, ciphertext FROM items WHERE seq > ? ORDER BY seq LIMIT ?',
        since,
        BACKFILL_PAGE + 1,
      )
      .toArray();
    const hasMore = rows.length > BACKFILL_PAGE;
    const page = (hasMore ? rows.slice(0, BACKFILL_PAGE) : rows).map((r) => ({
      seq: r.seq,
      channel: r.channel,
      itemId: r.item_id,
      clientMsgId: r.client_msg_id,
      senderMemberId: r.sender_member_id,
      createdAt: r.created_at,
      ciphertext: r.ciphertext,
    }));
    const nextSince = page.length ? page[page.length - 1].seq : since;
    return { items: page, hasMore, nextSince };
  }

  headSeq() {
    const row = this.sql.exec('SELECT MAX(seq) AS m FROM items').toArray()[0];
    return row?.m || 0;
  }

  broadcast(item) {
    const frame = JSON.stringify({ type: 'item', ...item });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(frame);
      } catch {
        /* сокет закрывается */
      }
    }
  }

  // === WebSocket (Hibernation API) ===
  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.close(1003, 'bad frame');
      return;
    }
    if (msg.type === 'hello') {
      ws.serializeAttachment({ memberId: msg.memberId || null });
      if (msg.memberId) {
        this.sql.exec(
          'INSERT INTO members (member_id, joined_at) VALUES (?, ?) ON CONFLICT(member_id) DO NOTHING',
          msg.memberId,
          new Date().toISOString(),
        );
      }
      let since = Number(msg.lastSeq || 0);
      for (;;) {
        const page = this.backfill(since);
        ws.send(JSON.stringify({ type: 'backfill', ...page }));
        since = page.nextSince;
        if (!page.hasMore) break;
      }
      ws.send(JSON.stringify({ type: 'ready', headSeq: this.headSeq() }));
      return;
    }
    if (msg.type === 'send') {
      const res = await this.ingest(msg);
      ws.send(JSON.stringify({ type: 'ack', clientMsgId: msg.clientMsgId || null, itemId: res.itemId, seq: res.seq }));
      return;
    }
  }

  webSocketClose(ws) {
    try {
      ws.close();
    } catch {
      /* уже закрыт */
    }
  }

  // === Web Push оффлайн-участникам (сигнал, не транспорт) ===
  async pushOffline(item, senderMemberId) {
    const online = new Set();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att?.memberId) online.add(att.memberId);
    }
    const vapid = {
      publicKey: this.env.VAPID_PUBLIC,
      privateKey: this.env.VAPID_PRIVATE,
      subject: this.env.VAPID_SUBJECT || 'mailto:noreply@life-hub.app',
    };
    if (!vapid.privateKey) return;
    const subs = this.sql
      .exec('SELECT member_id, push_sub FROM members WHERE push_sub IS NOT NULL AND member_id != ?', senderMemberId || '')
      .toArray();
    for (const m of subs) {
      if (online.has(m.member_id)) continue;
      try {
        const sub = JSON.parse(m.push_sub);
        const { endpoint, headers, body } = await buildPushRequest({
          subscription: sub,
          payload: JSON.stringify({ title: 'Семейный чат', body: 'Новое сообщение', family: true, tag: 'family-chat' }),
          vapid,
          ttl: 3600,
          urgency: 'high',
        });
        await fetch(endpoint, { method: 'POST', headers, body });
      } catch {
        /* мёртвая подписка — игнор */
      }
    }
  }

  prune() {
    const cutoff = new Date(Date.now() - MSG_RETENTION_DAYS * 86400_000).toISOString();
    this.sql.exec('DELETE FROM items WHERE channel=? AND created_at < ?', 'msg', cutoff);
    // сверх лимита по количеству — оставить только последние MSG_RETENTION_MAX
    const total = this.sql.exec("SELECT COUNT(*) AS c FROM items WHERE channel='msg'").toArray()[0].c;
    if (total > MSG_RETENTION_MAX) {
      this.sql.exec(
        "DELETE FROM items WHERE channel='msg' AND seq NOT IN (SELECT seq FROM items WHERE channel='msg' ORDER BY seq DESC LIMIT ?)",
        MSG_RETENTION_MAX,
      );
    }
  }
}
