// Регресс-тесты движка синхронизации — каждый ловит конкретный дефект,
// который жил в проде и терял данные:
//
// 1. Курсор push двигался на максимальный updatedAt среди отправленных строк.
//    Правка, сделанная во время скана в уже прочитанную таблицу, получала
//    штамп меньше курсора и не уезжала в облако никогда.
// 2. Между `if (running)` и `running = true` стоял await: два конкурентных
//    вызова runSync проходили проверку и гоняли курсоры наперегонки.
// 3. Одна «ядовитая» запись (битый шифротекст) роняла весь pull: курсор не
//    двигался, синхронизация вставала навсегда.
// 4. У habitLogs уникальный индекс &[habitId+date] при случайных id: отметка
//    привычки с двух устройств давала ConstraintError, запись молча терялась.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await import('../db/db');
const { generateKey, encryptJSON } = await import('./crypto');
const { getSyncConfig, patchSyncConfig } = await import('./syncState');
const { runSync, batchByBytes } = await import('./sync');

const realFetch = globalThis.fetch;

type FetchStub = (url: string, init?: RequestInit) => Promise<Response> | Response;

function jsonRes(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Подменить сеть. Обработчик получает url и init, отвечает за оба эндпоинта. */
function mockFetch(handler: FetchStub) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as typeof fetch;
}

/** Пустой pull + приём push с накоплением отправленных записей. */
function mockQuietNetwork(pushedOut?: { table: string; id: string; updatedAt: string }[]) {
  mockFetch((url, init) => {
    if (url.includes('/sync/pull')) return jsonRes({ records: [], hasMore: false, nextSince: '' });
    if (url.includes('/sync/push')) {
      if (pushedOut && init?.body) {
        pushedOut.push(...(JSON.parse(String(init.body)) as { records: typeof pushedOut }).records);
      }
      return jsonRes({ ok: true });
    }
    throw new Error(`неожиданный запрос: ${url}`);
  });
}

async function seedSync(): Promise<CryptoKey> {
  const key = await generateKey();
  await db.sync.put({
    id: 'config',
    accountId: 'acc-1',
    authToken: 'tok-1',
    key,
    enabled: true,
    lastPullAt: '',
    lastPushAt: '',
    lastSyncedAt: '',
  } as never);
  return key;
}

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  // Чистим ВСЕ таблицы, а не список поимённо: список молча устаревает, и
  // записи из прошлого теста ломают следующий там, где есть уникальные
  // индексы. Пересоздавать базу всё равно дороже.
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('курсор push', () => {
  it('двигается на cutoff и не перепрыгивает запись, легшую после снятия курсора', async () => {
    await seedSync();
    const past = new Date(Date.now() - 60_000).toISOString();
    // Запись «из будущего» моделирует правку, сделанную ПОСЛЕ снятия cutoff,
    // но ДО конца цикла — раньше она задирала курсор и терялась навсегда.
    // Запас 150 мс: между этой строкой и снятием cutoff в runSync — только
    // два put и мок сети, на порядок быстрее даже под нагрузкой CI.
    const future = new Date(Date.now() + 150).toISOString();
    await db.tasks.put({ id: 't-past', title: 'a', updatedAt: past, deletedAt: null } as never);
    await db.tasks.put({ id: 't-future', title: 'b', updatedAt: future, deletedAt: null } as never);

    const sent: { table: string; id: string; updatedAt: string }[] = [];
    mockQuietNetwork(sent);

    const r1 = await runSync();
    // Уехала только запись из окна; будущая — нет.
    expect(r1?.pushed).toBe(1);
    expect(sent.map((s) => s.id)).toEqual(['t-past']);
    // Курсор — cutoff цикла, он ОБЯЗАН быть меньше updatedAt будущей записи.
    // Старый код ставил сюда max(updatedAt)=future и запись выпадала навсегда.
    const c1 = await getSyncConfig();
    expect(c1 && c1.lastPushAt < future).toBe(true);

    // Время записи наступило — следующий цикл её доставляет.
    await new Promise((res) => setTimeout(res, 200));
    const r2 = await runSync();
    expect(r2?.pushed).toBe(1);
    expect(sent.map((s) => s.id)).toEqual(['t-past', 't-future']);
  });
});

describe('критическая секция runSync', () => {
  it('конкурентный вызов не запускает второй цикл', async () => {
    await seedSync();
    let pullCalls = 0;
    mockFetch(async (url) => {
      if (url.includes('/sync/pull')) {
        pullCalls++;
        await new Promise((res) => setTimeout(res, 20)); // держим цикл занятым
        return jsonRes({ records: [], hasMore: false, nextSince: '' });
      }
      return jsonRes({ ok: true });
    });

    const [a, b] = await Promise.all([runSync(), runSync()]);
    // Ровно один цикл дошёл до сети, второй вызов вышел по флагу.
    expect(pullCalls).toBe(1);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe('ядовитая запись в pull', () => {
  it('пропускается со счётчиком, не роняя цикл и не блокируя курсор', async () => {
    const key = await seedSync();
    const t = new Date().toISOString();
    const good = await encryptJSON(key, { id: 'n-ok', title: 'жив', updatedAt: t, deletedAt: null });
    mockFetch((url) => {
      if (url.includes('/sync/pull'))
        return jsonRes({
          records: [
            // Кириллица не пройдёт atob → InvalidCharacterError, запись «ядовитая».
            { table: 'notes', id: 'n-bad', updatedAt: t, deletedAt: null, ciphertext: 'мусор' },
            { table: 'notes', id: 'n-ok', updatedAt: t, deletedAt: null, ciphertext: good },
          ],
          hasMore: false,
          nextSince: `${t}|n-ok`,
        });
      return jsonRes({ ok: true });
    });

    const r = await runSync();
    // Битая пропущена и посчитана, валидная применена, курсор уехал вперёд.
    expect(r?.skipped).toBe(1);
    expect(r?.pulled).toBe(1);
    expect(await db.notes.get('n-ok')).toBeTruthy();
    const c = await getSyncConfig();
    expect(c?.lastPullAt).toBe(`${t}|n-ok`);
  });
});

describe('конфликт habitLogs по [habitId+date]', () => {
  it('входящая свежее — локальный дубль снимается, входящая записывается', async () => {
    const key = await seedSync();
    const older = '2026-08-16T10:00:00.000Z';
    const newer = '2026-08-16T11:00:00.000Z';
    await db.habitLogs.put({ id: 'local', habitId: 'h1', date: '2026-08-16', updatedAt: older, deletedAt: null } as never);
    const ct = await encryptJSON(key, { id: 'remote', habitId: 'h1', date: '2026-08-16', updatedAt: newer, deletedAt: null });
    mockFetch((url) => {
      if (url.includes('/sync/pull'))
        return jsonRes({
          records: [{ table: 'habitLogs', id: 'remote', updatedAt: newer, deletedAt: null, ciphertext: ct }],
          hasMore: false,
          nextSince: `${newer}|remote`,
        });
      return jsonRes({ ok: true });
    });

    const r = await runSync();
    // Без разрешения конфликта put падал ConstraintError и запись терялась.
    expect(r?.pulled).toBe(1);
    expect(await db.habitLogs.get('remote')).toBeTruthy();
    expect(await db.habitLogs.get('local')).toBeUndefined();
  });

  it('локальная свежее — входящая игнорируется', async () => {
    const key = await seedSync();
    const older = '2026-08-16T10:00:00.000Z';
    const newer = '2026-08-16T11:00:00.000Z';
    await db.habitLogs.put({ id: 'local', habitId: 'h1', date: '2026-08-16', updatedAt: newer, deletedAt: null } as never);
    const ct = await encryptJSON(key, { id: 'remote', habitId: 'h1', date: '2026-08-16', updatedAt: older, deletedAt: null });
    mockFetch((url) => {
      if (url.includes('/sync/pull'))
        return jsonRes({
          records: [{ table: 'habitLogs', id: 'remote', updatedAt: older, deletedAt: null, ciphertext: ct }],
          hasMore: false,
          nextSince: `${older}|remote`,
        });
      return jsonRes({ ok: true });
    });

    await runSync();
    expect(await db.habitLogs.get('local')).toBeTruthy();
    expect(await db.habitLogs.get('remote')).toBeUndefined();
  });
});

describe('конфликт energyLogs по date', () => {
  // У energyLogs уникальный индекс &date (db.ts, версия 16) — «одна отметка в
  // день». Та же ловушка, что у привычек, но разрешения конфликта для неё не
  // было: put падал с ConstraintError, а ConstraintError не считается
  // «ядовитой записью», значит pullPage бросал ошибку дальше и курсор
  // lastPullAt не двигался. Синхронизация вставала НАВСЕГДА и молча — вместе
  // с задачами, заметками, целями и финансами.
  it('входящая свежее — локальный дубль снимается, синк не встаёт', async () => {
    const key = await seedSync();
    const older = '2026-08-16T10:00:00.000Z';
    const newer = '2026-08-16T11:00:00.000Z';
    await db.energyLogs.put({ id: 'local', date: '2026-08-16', level: 2, updatedAt: older, deletedAt: null } as never);
    const ct = await encryptJSON(key, { id: 'remote', date: '2026-08-16', level: 5, updatedAt: newer, deletedAt: null });
    mockFetch((url) => {
      if (url.includes('/sync/pull'))
        return jsonRes({
          records: [{ table: 'energyLogs', id: 'remote', updatedAt: newer, deletedAt: null, ciphertext: ct }],
          hasMore: false,
          nextSince: `${newer}|remote`,
        });
      return jsonRes({ ok: true });
    });

    const r = await runSync();
    expect(r?.pulled).toBe(1);
    expect(await db.energyLogs.get('remote')).toBeTruthy();
    expect(await db.energyLogs.get('local')).toBeUndefined();
    // И главное: курсор уехал вперёд, то есть следующий цикл пойдёт дальше.
    const c = await getSyncConfig();
    expect(c?.lastPullAt).toBe(`${newer}|remote`);
  });

  it('локальная свежее — входящая игнорируется', async () => {
    const key = await seedSync();
    const older = '2026-08-16T10:00:00.000Z';
    const newer = '2026-08-16T11:00:00.000Z';
    await db.energyLogs.put({ id: 'local', date: '2026-08-16', level: 4, updatedAt: newer, deletedAt: null } as never);
    const ct = await encryptJSON(key, { id: 'remote', date: '2026-08-16', level: 1, updatedAt: older, deletedAt: null });
    mockFetch((url) => {
      if (url.includes('/sync/pull'))
        return jsonRes({
          records: [{ table: 'energyLogs', id: 'remote', updatedAt: older, deletedAt: null, ciphertext: ct }],
          hasMore: false,
          nextSince: `${older}|remote`,
        });
      return jsonRes({ ok: true });
    });

    await runSync();
    expect(await db.energyLogs.get('local')).toBeTruthy();
    expect(await db.energyLogs.get('remote')).toBeUndefined();
  });

  it('мягко удалённая отметка держит дату — входящая всё равно применяется', async () => {
    // Снять отметку через приложение = мягкое удаление: строка остаётся и
    // продолжает занимать date. Без разрешения конфликта человек не мог бы
    // починить синк даже вручную.
    const key = await seedSync();
    const older = '2026-08-16T10:00:00.000Z';
    const newer = '2026-08-16T11:00:00.000Z';
    await db.energyLogs.put({
      id: 'local', date: '2026-08-16', level: 2, updatedAt: older, deletedAt: older,
    } as never);
    const ct = await encryptJSON(key, { id: 'remote', date: '2026-08-16', level: 5, updatedAt: newer, deletedAt: null });
    mockFetch((url) => {
      if (url.includes('/sync/pull'))
        return jsonRes({
          records: [{ table: 'energyLogs', id: 'remote', updatedAt: newer, deletedAt: null, ciphertext: ct }],
          hasMore: false,
          nextSince: `${newer}|remote`,
        });
      return jsonRes({ ok: true });
    });

    const r = await runSync();
    expect(r?.pulled).toBe(1);
    expect(await db.energyLogs.get('remote')).toBeTruthy();
  });
});

describe('отправка изменений не читает таблицы целиком', () => {
  it('берёт окно по индексу updatedAt, а не всю базу', async () => {
    // Раньше push читал КАЖДУЮ из двадцати синхронизируемых таблиц целиком и
    // отбирал свежие строки уже в памяти. Среди них noteFiles — куски
    // вложений по 400 КиБ — и tasks с фотографиями прямо в строке. И всё это
    // через полторы секунды после каждой правки: пока пишешь заметку, на
    // каждую паузу в наборе поднималась вся база.
    //
    // Отличить одно от другого можно точно: полное чтение идёт через
    // store.getAll, выборка по индексу — через index.getAll.
    await seedSync();
    const old = '2020-01-01T00:00:00.000Z';
    // Полсотни старых записей, которые отправлять не нужно.
    await db.notes.bulkPut(
      Array.from({ length: 50 }, (_, i) => ({
        id: `n${i}`,
        title: `Заметка ${i}`,
        content: 'x'.repeat(5000),
        createdAt: old,
        updatedAt: old,
        deletedAt: null,
      })) as never[],
    );
    await patchSyncConfig({ lastPushAt: '2026-01-01T00:00:00.000Z' });
    // И одна свежая — только она и должна уехать.
    const fresh = new Date().toISOString();
    await db.notes.put({
      id: 'fresh', title: 'Свежая', content: 'привет',
      createdAt: fresh, updatedAt: fresh, deletedAt: null,
    } as never);

    // Считаем ИМЕНА таблиц, прочитанных целиком: пара служебных (например,
    // список семейных подключений — единицы строк) читается полностью и
    // законно, а вот синхронизируемых среди них быть не должно.
    const scanned: string[] = [];
    let indexReads = 0;
    const orig = {
      store: IDBObjectStore.prototype.getAll,
      index: IDBIndex.prototype.getAll,
    };
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...args: unknown[]) {
      scanned.push(this.name);
      return (orig.store as (...a: unknown[]) => IDBRequest).apply(this, args);
    } as typeof orig.store;
    IDBIndex.prototype.getAll = function (this: IDBIndex, ...args: unknown[]) {
      indexReads += 1;
      return (orig.index as (...a: unknown[]) => IDBRequest).apply(this, args);
    } as typeof orig.index;

    const pushed: { table: string; id: string; updatedAt: string }[] = [];
    mockQuietNetwork(pushed);

    try {
      await runSync();
    } finally {
      IDBObjectStore.prototype.getAll = orig.store;
      IDBIndex.prototype.getAll = orig.index;
    }

    // Уехала ровно свежая запись.
    expect(pushed.map((r) => r.id)).toEqual(['fresh']);
    // Ни одна таблица с пользовательскими данными не прочитана целиком.
    expect(scanned.filter((name) => name === 'notes' || name === 'tasks' || name === 'noteFiles')).toEqual([]);
    expect(indexReads).toBeGreaterThan(0);
  });
});

describe('семейные подключения уезжают на другие устройства', () => {
  it('свежая группа попадает в отправку, старая — нет', async () => {
    // Группы читаются иначе, чем остальные таблицы (индекса по updatedAt у них
    // нет, да и групп единицы), поэтому отбор окна для них написан отдельно —
    // и однажды уже отвалился при правке соседнего кода: осталась ссылка на
    // удалённую функцию, то есть отправка падала бы целиком.
    await seedSync();
    await patchSyncConfig({ lastPushAt: '2026-01-01T00:00:00.000Z' });
    const key = await generateKey();
    const base = {
      familyToken: 'tok', familyKey: key, familyName: 'Наши', selfMemberId: 'me',
      lastSeq: 0, lastReadSeq: 0, enabled: true, joinedAt: '2026-01-01T00:00:00.000Z',
      keyEpoch: 0, keyRing: { '0': key }, deletedAt: null,
    };
    await db.family.bulkPut([
      { ...base, id: 'old', familyId: 'old', updatedAt: '2025-06-01T00:00:00.000Z' },
      { ...base, id: 'new', familyId: 'new', updatedAt: new Date().toISOString() },
    ] as never[]);

    const sent: { table: string; id: string; updatedAt: string }[] = [];
    mockQuietNetwork(sent);
    await runSync();

    const shares = sent.filter((r) => r.table === 'familyShare');
    expect(shares.map((r) => r.id)).toEqual(['new']);
  });
});

describe('пачки отправки ограничены объёмом, а не только числом записей', () => {
  it('тяжёлые записи едут порознь — иначе тело запроса вырастает до сотен мегабайт', () => {
    // Строки бывают очень разные: обычная задача — сотни байт, кусок вложения
    // заметки — больше полумегабайта после шифрования. Двести таких кусков в
    // одном теле запроса не уйдут никогда: обмен падает на каждой попытке,
    // курсор стоит, синхронизация мертва навсегда.
    const heavy = (id: string) => ({
      table: 'noteFiles',
      id,
      updatedAt: '2026-08-22T00:00:00.000Z',
      deletedAt: null,
      ciphertext: 'x'.repeat(1_200_000),
    });
    const batches = batchByBytes([heavy('a'), heavy('b'), heavy('c'), heavy('d')]);

    // По три штуки в пачку не влезает — потолок три мегабайта.
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) {
      const size = b.reduce((n, r) => n + r.ciphertext.length, 0);
      // Пачка либо в пределах потолка, либо состоит из одной записи.
      expect(size <= 3 * 1024 * 1024 || b.length === 1).toBe(true);
    }
    // Ничего не потеряли и порядок сохранён.
    expect(batches.flat().map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('запись тяжелее потолка едет одна, а не блокирует обмен', () => {
    const giant = {
      table: 'noteFiles', id: 'big', updatedAt: '2026-08-22T00:00:00.000Z',
      deletedAt: null, ciphertext: 'x'.repeat(5 * 1024 * 1024),
    };
    const small = {
      table: 'tasks', id: 't1', updatedAt: '2026-08-22T00:00:01.000Z',
      deletedAt: null, ciphertext: 'привет',
    };
    const batches = batchByBytes([giant, small]);
    expect(batches[0].map((r) => r.id)).toEqual(['big']);
    expect(batches[1].map((r) => r.id)).toEqual(['t1']);
  });

  it('лёгкие записи собираются в пачку, а не по одной', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      table: 'tasks', id: `t${i}`, updatedAt: '2026-08-22T00:00:00.000Z',
      deletedAt: null, ciphertext: 'короткая строка',
    }));
    expect(batchByBytes(rows)).toHaveLength(1);
  });
});
