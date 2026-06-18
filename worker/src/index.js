// Life Hub бэкенд (Cloudflare Worker) — пуши + E2E-синхронизация.
// HTTP:
//   /health                  — проверка живости
//   /schedule, /cancel       — напоминания (push), KV REMINDERS
//   /sync/push, /sync/pull   — синхронизация записей, D1 (только шифротекст)
// Cron (раз в минуту): шлёт пуши, у которых наступило время.

import { buildPushRequest } from './webpush.js';
export { FamilyRoom } from './familyRoom.js';

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Account',
  'Access-Control-Max-Age': '86400',
});

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Авторизация синка: X-Account = accountId, Authorization: Bearer <token>.
// Возвращает accountId при успехе, иначе null. Первое обращение с новым
// (неугадываемым) accountId регистрирует пару — trust on first use.
async function authAccount(request, env) {
  const accountId = request.headers.get('X-Account');
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!accountId || !token) return null;
  const hash = await sha256hex(token);
  const row = await env.DB.prepare('SELECT token_hash FROM accounts WHERE account_id = ?')
    .bind(accountId)
    .first();
  if (!row) {
    await env.DB.prepare('INSERT INTO accounts (account_id, token_hash, created_at) VALUES (?, ?, ?)')
      .bind(accountId, hash, new Date().toISOString())
      .run();
    return accountId;
  }
  return row.token_hash === hash ? accountId : null;
}

const PULL_LIMIT = 500;

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true }, 200, origin);

      // === Напоминания (push) ===
      if (url.pathname === '/schedule' && request.method === 'POST') {
        const { taskId, fireAt, title, body, subscription } = await request.json();
        if (!taskId || typeof fireAt !== 'number' || !subscription?.endpoint) {
          return json({ error: 'bad request' }, 400, origin);
        }
        await env.REMINDERS.put(
          `r:${taskId}`,
          JSON.stringify({ taskId, fireAt, title, body, subscription }),
          { metadata: { fireAt } },
        );
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === '/cancel' && request.method === 'POST') {
        const { taskId } = await request.json();
        if (taskId) await env.REMINDERS.delete(`r:${taskId}`);
        return json({ ok: true }, 200, origin);
      }

      // === Синхронизация (E2E) ===
      if (url.pathname === '/sync/push' && request.method === 'POST') {
        const accountId = await authAccount(request, env);
        if (!accountId) return json({ error: 'unauthorized' }, 401, origin);
        const { records } = await request.json();
        if (!Array.isArray(records)) return json({ error: 'bad request' }, 400, origin);

        const stmt = env.DB.prepare(
          `INSERT INTO records (account_id, table_name, id, updated_at, deleted_at, ciphertext)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, table_name, id) DO UPDATE SET
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             ciphertext = excluded.ciphertext
           WHERE excluded.updated_at > records.updated_at`,
        );
        const batch = [];
        for (const r of records) {
          if (!r || typeof r.table !== 'string' || typeof r.id !== 'string') continue;
          if (typeof r.updatedAt !== 'string' || typeof r.ciphertext !== 'string') continue;
          batch.push(stmt.bind(accountId, r.table, r.id, r.updatedAt, r.deletedAt ?? null, r.ciphertext));
        }
        if (batch.length) await env.DB.batch(batch);
        return json({ ok: true, count: batch.length }, 200, origin);
      }

      if (url.pathname === '/sync/pull' && request.method === 'GET') {
        const accountId = await authAccount(request, env);
        if (!accountId) return json({ error: 'unauthorized' }, 401, origin);
        const since = url.searchParams.get('since') || '';
        const res = await env.DB.prepare(
          `SELECT table_name AS tbl, id, updated_at AS u, deleted_at AS d, ciphertext AS c
           FROM records WHERE account_id = ? AND updated_at > ?
           ORDER BY updated_at, id LIMIT ?`,
        )
          .bind(accountId, since, PULL_LIMIT + 1)
          .all();
        const rows = res.results || [];
        const hasMore = rows.length > PULL_LIMIT;
        const page = hasMore ? rows.slice(0, PULL_LIMIT) : rows;
        const out = page.map((r) => ({
          table: r.tbl,
          id: r.id,
          updatedAt: r.u,
          deletedAt: r.d,
          ciphertext: r.c,
        }));
        const nextSince = out.length ? out[out.length - 1].updatedAt : since;
        return json({ records: out, hasMore, nextSince }, 200, origin);
      }

      // === Семья: проксируем в Durable Object (1 комната на семью) ===
      if (url.pathname.startsWith('/family/')) {
        const familyId = url.searchParams.get('familyId') || request.headers.get('X-Account');
        if (!familyId) return json({ error: 'no family' }, 400, origin);
        const stub = env.FAMILY_ROOM.get(env.FAMILY_ROOM.idFromName(familyId));
        const res = await stub.fetch(request);
        if (res.webSocket) return res; // WS upgrade — отдаём как есть
        const h = new Headers(res.headers);
        for (const [k, v] of Object.entries(corsHeaders(origin))) h.set(k, v);
        return new Response(res.body, { status: res.status, headers: h });
      }

      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      return json({ error: String(e) }, 500, origin);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDue(env));
  },
};

async function sendDue(env) {
  const vapid = {
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE,
    subject: env.VAPID_SUBJECT || 'mailto:noreply@life-hub.app',
  };
  const now = Date.now();
  let cursor;
  do {
    const list = await env.REMINDERS.list({ prefix: 'r:', cursor, limit: 1000 });
    cursor = list.list_complete ? undefined : list.cursor;
    for (const key of list.keys) {
      const fireAt = key.metadata?.fireAt;
      // ещё не пора (запас 30с — cron раз в минуту); пропускаем
      if (typeof fireAt === 'number' && fireAt > now + 30_000) continue;
      const raw = await env.REMINDERS.get(key.name);
      if (!raw) continue;
      const r = JSON.parse(raw);
      try {
        const { endpoint, headers, body } = await buildPushRequest({
          subscription: r.subscription,
          payload: JSON.stringify({ title: r.title || 'Напоминание', body: r.body || '', taskId: r.taskId }),
          vapid,
          ttl: 3600,
          urgency: 'high',
        });
        const res = await fetch(endpoint, { method: 'POST', headers, body });
        console.log(`push ${r.taskId}: ${res.status}`);
      } catch (e) {
        console.log(`push ${r.taskId} error: ${String(e)}`);
      }
      // снимаем в любом случае — напоминание одноразовое (404/410 = подписка мертва)
      await env.REMINDERS.delete(key.name);
    }
  } while (cursor);
}
