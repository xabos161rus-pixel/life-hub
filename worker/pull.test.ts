// Составной курсор /sync/pull: "updatedAt|id" вместо одного updatedAt.
//
// Дефект, который это закрывает: сортировка страницы идёт по (updated_at, id),
// а курсор двигался только по updated_at. Записи с одинаковым миллисекундным
// штампом, не поместившиеся на страницу, терялись навсегда — следующий запрос
// просил строго больше этого значения. На сервере всё цело, на устройстве
// записей нет, причина ниоткуда не видна.

import { describe, expect, it, vi } from 'vitest';

// index.js реэкспортирует FamilyRoom, а тот тянет модуль, которого вне Workers
// не существует. Сам Durable Object здесь не нужен.
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const worker = await import('./src/index.js');

const ORIGIN = 'https://xabos161rus-pixel.github.io';

interface PullRow {
  tbl: string;
  id: string;
  u: string;
  d: string | null;
  c: string;
}

/** Мок D1: авторизация проходит по TOFU (аккаунт не найден → регистрируется),
 *  выборка pull отдаёт заготовленные строки и записывает связанные параметры. */
function makeDb(rows: PullRow[]) {
  const pullBinds: unknown[][] = [];
  const pullSql: string[] = [];
  return {
    pullBinds,
    pullSql,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              return null; // accounts: не найден → TOFU-регистрация
            },
            async run() {
              return {}; // INSERT INTO accounts
            },
            async all() {
              if (!sql.includes('FROM records')) throw new Error(`неожиданный all(): ${sql}`);
              pullSql.push(sql);
              pullBinds.push(args);
              return { results: rows };
            },
          };
        },
      };
    },
  };
}

async function pull(db: ReturnType<typeof makeDb>, since: string) {
  return worker.default.fetch(
    new Request(`https://life-hub-push.workers.dev/sync/pull?since=${encodeURIComponent(since)}`, {
      headers: {
        Origin: ORIGIN,
        'X-Account': 'acc-1',
        Authorization: 'Bearer tok-1',
      },
    }),
    { ALLOW_ORIGIN: ORIGIN, DB: db },
    { waitUntil: () => {} },
  );
}

describe('/sync/pull: составной курсор', () => {
  it('SQL сравнивает row values (updated_at, id) — иначе записи на границе страницы теряются', async () => {
    const db = makeDb([]);
    await pull(db, '');
    // Форма запроса важна: с эквивалентным OR вместо row values SQLite не
    // делает seek по индексу и сканирует все записи аккаунта на каждый опрос.
    expect(db.pullSql).toHaveLength(1);
    expect(db.pullSql[0]).toContain('(updated_at, id) > (?, ?)');
  });

  it('старый курсор без "|" разбирается как метка с пустым id', async () => {
    const db = makeDb([]);
    await pull(db, '2026-08-16T10:00:00.000Z');
    const [, sinceU, sinceId] = db.pullBinds[0];
    expect(sinceU).toBe('2026-08-16T10:00:00.000Z');
    expect(sinceId).toBe('');
  });

  it('составной курсор "u|id" разбирается на пару', async () => {
    const db = makeDb([]);
    await pull(db, '2026-08-16T10:00:00.000Z|rec-42');
    const [, sinceU, sinceId] = db.pullBinds[0];
    expect(sinceU).toBe('2026-08-16T10:00:00.000Z');
    expect(sinceId).toBe('rec-42');
  });

  it('nextSince — пара последней записи страницы, чтобы одинаковые метки не терялись', async () => {
    const t = '2026-08-16T10:00:00.000Z';
    const db = makeDb([
      { tbl: 'tasks', id: 'a', u: t, d: null, c: 'ct-a' },
      { tbl: 'tasks', id: 'b', u: t, d: null, c: 'ct-b' },
    ]);
    const res = await pull(db, '');
    const data = (await res.json()) as { nextSince: string; records: unknown[] };
    expect(data.records).toHaveLength(2);
    expect(data.nextSince).toBe(`${t}|b`);
  });

  it('пустая страница не сбрасывает курсор', async () => {
    const db = makeDb([]);
    const res = await pull(db, '2026-08-16T10:00:00.000Z|rec-42');
    const data = (await res.json()) as { nextSince: string };
    expect(data.nextSince).toBe('2026-08-16T10:00:00.000Z|rec-42');
  });
});
