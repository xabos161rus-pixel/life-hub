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

// Таблицу резервных копий создаём лениво (миграции D1 в этом проекте применяются
// вручную; ленивое создание убирает этот шаг — фича работает сразу после деплоя).
let backupTableReady = false;
async function ensureBackupTable(env) {
  if (backupTableReady) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS backups (
       account_id TEXT NOT NULL,
       chunk INTEGER NOT NULL DEFAULT 0,
       updated_at TEXT NOT NULL,
       ciphertext TEXT NOT NULL,
       PRIMARY KEY (account_id, chunk)
     )`,
  ).run();
  backupTableReady = true;
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true }, 200, origin);

      // === Напоминания (push) — хранятся в D1 (cron делает SELECT, не KV list) ===
      if (url.pathname === '/schedule' && request.method === 'POST') {
        const { taskId, fireAt, title, body, subscription } = await request.json();
        if (!taskId || typeof fireAt !== 'number' || !subscription?.endpoint) {
          return json({ error: 'bad request' }, 400, origin);
        }
        await env.DB.prepare(
          'INSERT OR REPLACE INTO reminders (task_id, fire_at, title, body, subscription) VALUES (?, ?, ?, ?, ?)',
        )
          .bind(taskId, fireAt, title || '', body || '', JSON.stringify(subscription))
          .run();
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === '/cancel' && request.method === 'POST') {
        const { taskId } = await request.json();
        if (taskId) await env.DB.prepare('DELETE FROM reminders WHERE task_id = ?').bind(taskId).run();
        return json({ ok: true }, 200, origin);
      }

      // Регистрация подписки в глобальный список (для рассылки об обновлении).
      if (url.pathname === '/push-register' && request.method === 'POST') {
        const { subscription } = await request.json();
        if (subscription?.endpoint) {
          await env.DB.prepare('INSERT OR REPLACE INTO push_subs (endpoint, sub, created_at) VALUES (?, ?, ?)')
            .bind(subscription.endpoint, JSON.stringify(subscription), new Date().toISOString())
            .run();
        }
        return json({ ok: true }, 200, origin);
      }

      // Рассылка «вышло обновление» всем подписанным устройствам (по секрету).
      if (url.pathname === '/notify-update' && request.method === 'POST') {
        if ((request.headers.get('Authorization') || '') !== `Bearer ${env.UPDATE_TOKEN}`) {
          return json({ error: 'unauthorized' }, 401, origin);
        }
        // Опциональный текст «что нового»; иначе — текст по умолчанию.
        let custom = {};
        try {
          custom = await request.json();
        } catch {
          /* тела нет */
        }
        const notifyBody =
          custom && typeof custom.body === 'string' && custom.body.trim()
            ? custom.body.trim().slice(0, 140)
            : DEFAULT_UPDATE_TEXT;
        const sent = await broadcastUpdate(env, notifyBody);
        return json({ ok: true, sent }, 200, origin);
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

      // === Резервная копия аккаунта (E2E, только шифротекст) ===
      // Отдельно от /sync/*: снапшот — крупный блоб, не должен попадать в
      // дельта-поток синка. Модель latest-only: одна копия на аккаунт,
      // при необходимости разбита на чанки (лимит значения колонки D1 — 2 МБ).
      if (url.pathname === '/backup/put' && request.method === 'POST') {
        const accountId = await authAccount(request, env);
        if (!accountId) return json({ error: 'unauthorized' }, 401, origin);
        await ensureBackupTable(env);
        const { chunks, total } = await request.json();
        if (!Array.isArray(chunks) || typeof total !== 'number') {
          return json({ error: 'bad request' }, 400, origin);
        }
        const at = new Date().toISOString();
        // Удаляем «хвост» от прошлой, более длинной копии, затем перезаписываем.
        const batch = [
          env.DB.prepare('DELETE FROM backups WHERE account_id = ? AND chunk >= ?').bind(accountId, total),
        ];
        const put = env.DB.prepare(
          'INSERT OR REPLACE INTO backups (account_id, chunk, updated_at, ciphertext) VALUES (?, ?, ?, ?)',
        );
        for (const c of chunks) {
          if (!c || typeof c.chunk !== 'number' || typeof c.ciphertext !== 'string') continue;
          batch.push(put.bind(accountId, c.chunk, at, c.ciphertext));
        }
        await env.DB.batch(batch);
        return json({ ok: true, at }, 200, origin);
      }

      if (url.pathname === '/backup/get' && request.method === 'GET') {
        const accountId = await authAccount(request, env);
        if (!accountId) return json({ error: 'unauthorized' }, 401, origin);
        await ensureBackupTable(env);
        const res = await env.DB.prepare(
          'SELECT chunk, updated_at AS u, ciphertext AS c FROM backups WHERE account_id = ? ORDER BY chunk',
        )
          .bind(accountId)
          .all();
        const rows = res.results || [];
        return json(
          {
            chunks: rows.map((r) => ({ chunk: r.chunk, ciphertext: r.c })),
            updatedAt: rows.length ? rows[0].u : null,
          },
          200,
          origin,
        );
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
    ctx.waitUntil(checkAppVersion(env)); // сторож версии → авто-пуш об обновлении
  },
};

const DEFAULT_UPDATE_TEXT = 'Откройте приложение и нажмите «Обновить»';
const APP_INDEX_URL = 'https://xabos161rus-pixel.github.io/life-hub/index.html';

/** Разослать пуш «вышло обновление» всем подписчикам. Возвращает число доставок. */
async function broadcastUpdate(env, bodyText) {
  const vapid = {
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE,
    subject: env.VAPID_SUBJECT || 'mailto:noreply@life-hub.app',
  };
  if (!vapid.privateKey) return 0;
  const subs = await env.DB.prepare('SELECT endpoint, sub FROM push_subs').all();
  let sent = 0;
  for (const r of subs.results || []) {
    try {
      const { endpoint, headers, body } = await buildPushRequest({
        subscription: JSON.parse(r.sub),
        payload: JSON.stringify({ title: '✨ Доступно обновление', body: bodyText, url: '/life-hub/', tag: 'app-update' }),
        vapid,
        ttl: 86400,
        urgency: 'normal',
      });
      const res = await fetch(endpoint, { method: 'POST', headers, body });
      if (res.ok) sent++;
      else if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(r.endpoint).run();
      }
    } catch {
      /* мёртвая подписка — пропускаем */
    }
  }
  return sent;
}

/** Cron-сторож версии: при каждом новом деплое (сменился хэш JS-бандла в
 *  index.html живого сайта) — авто-рассылка пуша об обновлении. Первое
 *  наблюдение лишь запоминает версию, не уведомляя. */
async function checkAppVersion(env) {
  try {
    const res = await fetch(`${APP_INDEX_URL}?_=${Date.now()}`, {
      headers: { 'cache-control': 'no-cache' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
    if (!m) return;
    const version = m[0];
    const row = await env.DB.prepare('SELECT v FROM app_meta WHERE k = ?').bind('app_version').first();
    const prev = row ? row.v : null;
    if (prev === version) return; // версия не менялась
    await env.DB.prepare('INSERT OR REPLACE INTO app_meta (k, v) VALUES (?, ?)').bind('app_version', version).run();
    if (prev === null) return; // первое наблюдение — не уведомляем
    await broadcastUpdate(env, DEFAULT_UPDATE_TEXT);
  } catch {
    /* транзиентная ошибка — попробуем на следующем тике cron */
  }
}

async function sendDue(env) {
  const vapid = {
    publicKey: env.VAPID_PUBLIC,
    privateKey: env.VAPID_PRIVATE,
    subject: env.VAPID_SUBJECT || 'mailto:noreply@life-hub.app',
  };
  // Запас 30с (cron раз в минуту). Один SELECT по индексу fire_at вместо
  // KV list — D1-чтения практически безлимитны на free-тарифе.
  const due = await env.DB.prepare('SELECT task_id, fire_at, title, body, subscription FROM reminders WHERE fire_at <= ?')
    .bind(Date.now() + 30_000)
    .all();
  for (const r of due.results || []) {
    try {
      const { endpoint, headers, body } = await buildPushRequest({
        subscription: JSON.parse(r.subscription),
        payload: JSON.stringify({ title: r.title || 'Напоминание', body: r.body || '', taskId: r.task_id }),
        vapid,
        ttl: 3600,
        urgency: 'high',
      });
      const res = await fetch(endpoint, { method: 'POST', headers, body });
      console.log(`push ${r.task_id}: ${res.status}`);
    } catch (e) {
      console.log(`push ${r.task_id} error: ${String(e)}`);
    }
    // снимаем в любом случае — напоминание одноразовое (404/410 = подписка мертва)
    await env.DB.prepare('DELETE FROM reminders WHERE task_id = ?').bind(r.task_id).run();
  }
}
