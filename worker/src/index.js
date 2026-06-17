// Life Hub push-бэкенд (Cloudflare Worker).
// HTTP: /schedule (поставить напоминание), /cancel (снять), /health.
// Cron (раз в минуту): шлёт пуши, у которых наступило время.
// Хранилище: KV REMINDERS, ключ r:<taskId> = JSON напоминания, fireAt в metadata.

import { buildPushRequest } from './webpush.js';

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true }, 200, origin);

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
