// Защита единственной облачной копии от перезаписи «пустым» устройством.
//
// Хранение latest-only: /backup/put стирает прежнюю копию и кладёт новую. При
// этом часть таблиц — история цикла и семейная переписка — дельта-синком НЕ
// возится (см. SYNCED_TABLES в lib/sync.ts) и существует ровно на том
// устройстве, где её вводили. А отметка «копия создана» лежит в settings,
// которые между устройствами тоже не синхронизируются, — то есть на втором
// телефоне в настройках всегда горело «копию ещё не делали».
//
// Отсюда сценарий потери: копия сделана с основного устройства, человек
// открывает настройки на втором, видит «ещё не создана», жмёт «Сохранить
// сейчас» — и полная копия заменяется снапшотом без цикла и без переписки.
// Вернуть неоткуда.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = await import('../db/db');
const { generateKey } = await import('./crypto');
const { encryptJSON } = await import('./crypto');
const { pushAccountSnapshot, BackupWouldLoseDataError } = await import('./cloudBackup');

const realFetch = globalThis.fetch;

/** Что «лежит в облаке» на время теста. null — копии нет. */
let remote: { chunks: { chunk: number; ciphertext: string }[]; updatedAt: string | null } = {
  chunks: [],
  updatedAt: null,
};
/** Манифест копии: несколько чисел о её содержимом под шифром. null — копия
 *  снята прежней версией и манифеста не имеет. */
let remoteManifest: string | null = null;
let putCalls = 0;

async function seedSync() {
  const key = await generateKey();
  await db.sync.put({
    id: 'config',
    enabled: true,
    accountId: 'acc-1',
    authToken: 'tok-1',
    key,
    lastPulledAt: null,
  } as never);
  return key;
}

/** Положить в «облако» копию с заданным числом записей цикла. */
async function putRemote(key: CryptoKey, cycleDays: number) {
  const file = {
    app: 'life-hub',
    schemaVersion: 12,
    exportedAt: '2026-07-01T00:00:00.000Z',
    data: {
      cycleDays: Array.from({ length: cycleDays }, (_, i) => ({ date: `2026-01-${i + 1}` })),
      familyMessages: [],
    },
  };
  remote = {
    chunks: [{ chunk: 0, ciphertext: await encryptJSON(key, JSON.stringify(file)) }],
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('перезапись облачной копии', () => {
  beforeEach(async () => {
    putCalls = 0;
    remote = { chunks: [], updatedAt: null };
    remoteManifest = null;
    await Promise.all([db.sync.clear(), db.cycleDays.clear(), db.cycleSettings.clear()]);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/backup/meta')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              updatedAt: remote.updatedAt,
              total: remote.chunks.length,
              manifest: remoteManifest,
            }),
            { status: 200 },
          ),
        );
      }
      if (url.endsWith('/backup/get')) {
        return Promise.resolve(new Response(JSON.stringify(remote), { status: 200 }));
      }
      if (url.endsWith('/backup/put')) {
        putCalls++;
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });

  it('устройство без данных НЕ затирает полную копию', async () => {
    const key = await seedSync();
    await putRemote(key, 214); // на основном устройстве 214 дней цикла
    // здесь — ни одного

    await expect(pushAccountSnapshot()).rejects.toThrow(BackupWouldLoseDataError);
    expect(putCalls, 'запись вообще не должна была уйти').toBe(0);
  });

  it('в ошибке сказано, чего именно лишимся и от какого числа копия', async () => {
    // Без чисел сообщение бесполезно: «что-то потеряется» человек прочитает
    // как «опять что-то не так» и нажмёт «всё равно».
    const key = await seedSync();
    await putRemote(key, 214);
    try {
      await pushAccountSnapshot();
      expect.unreachable('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(BackupWouldLoseDataError);
      const err = e as InstanceType<typeof BackupWouldLoseDataError>;
      expect(err.losing).toContainEqual({ table: 'cycleDays', had: 214, now: 0 });
      expect(err.remoteDate).toBe('2026-07-01T00:00:00.000Z');
    }
  });

  it('force записывает: осознанное «да, всё равно заменить»', async () => {
    const key = await seedSync();
    await putRemote(key, 214);
    await expect(pushAccountSnapshot(true)).resolves.toBeGreaterThan(0);
    expect(putCalls).toBe(1);
  });

  it('данных стало БОЛЬШЕ — пишем молча, вопросов не задаём', async () => {
    const key = await seedSync();
    await putRemote(key, 2);
    await db.cycleDays.bulkPut([
      { date: '2026-01-01' },
      { date: '2026-01-02' },
      { date: '2026-01-03' },
    ] as never[]);
    await expect(pushAccountSnapshot()).resolves.toBeGreaterThan(0);
    expect(putCalls).toBe(1);
  });

  it('копии в облаке нет — первая запись проходит', async () => {
    await seedSync();
    await expect(pushAccountSnapshot()).resolves.toBeGreaterThan(0);
    expect(putCalls).toBe(1);
  });

  it('облако не отвечает — копию всё равно делаем', async () => {
    // Остаться совсем без копии опаснее, чем заменить ту, которую не удалось
    // прочитать. Иначе одна повреждённая копия заблокировала бы резервное
    // копирование навсегда.
    await seedSync();
    const prev = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/backup/get')) return Promise.reject(new TypeError('Failed to fetch'));
      return prev(input as RequestInfo, init);
    }) as typeof fetch;
    await expect(pushAccountSnapshot()).resolves.toBeGreaterThan(0);
    expect(putCalls).toBe(1);
  });

  it('синхронизация выключена — копии нет и запроса нет', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(pushAccountSnapshot()).resolves.toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('защита копии не зависит от её размера', () => {
  beforeEach(async () => {
    putCalls = 0;
    remote = { chunks: [], updatedAt: null };
    remoteManifest = null;
    await Promise.all([db.sync.clear(), db.cycleDays.clear(), db.cycleSettings.clear()]);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.endsWith('/backup/meta')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ updatedAt: remote.updatedAt, total: remote.chunks.length, manifest: remoteManifest }),
            { status: 200 },
          ),
        );
      }
      // Скачивание копии ПАДАЕТ — ровно то, что случается, когда копия
      // большая: не хватило памяти или вышел таймаут.
      if (url.endsWith('/backup/get')) return Promise.reject(new Error('слишком большая копия'));
      if (url.endsWith('/backup/put')) {
        putCalls++;
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
  });

  it('копия не затирается, даже когда скачать её не удалось', async () => {
    // Раньше это и был самый опасный случай: ошибка скачивания означала
    // «пиши так», и защита молча отключалась тем вернее, чем больше данных
    // было под угрозой.
    const key = await seedSync();
    remote.chunks = [{ chunk: 0, ciphertext: 'неважно' }];
    remote.updatedAt = '2026-07-01T00:00:00.000Z';
    remoteManifest = await encryptJSON(key, { cycleDays: 214, familyMessages: 900 });

    await expect(pushAccountSnapshot()).rejects.toThrow(BackupWouldLoseDataError);
    expect(putCalls, 'запись не должна была уйти').toBe(0);
  });

  it('в ошибке видно, чего именно лишились бы', async () => {
    const key = await seedSync();
    remote.chunks = [{ chunk: 0, ciphertext: 'неважно' }];
    remoteManifest = await encryptJSON(key, { cycleDays: 214 });

    try {
      await pushAccountSnapshot();
      throw new Error('ожидали отказ');
    } catch (e) {
      expect(e).toBeInstanceOf(BackupWouldLoseDataError);
      const err = e as InstanceType<typeof BackupWouldLoseDataError>;
      expect(err.losing.find((l) => l.table === 'cycleDays')?.had).toBe(214);
    }
  });

  it('когда терять нечего — копия пишется', async () => {
    const key = await seedSync();
    remote.chunks = [{ chunk: 0, ciphertext: 'неважно' }];
    remoteManifest = await encryptJSON(key, { cycleDays: 0, familyMessages: 0 });

    await pushAccountSnapshot();
    expect(putCalls).toBe(1);
  });

  it('копия прежней версии без манифеста не блокирует запись навсегда', async () => {
    // Скачать её не удалось, манифеста нет — остаться совсем без копии
    // опаснее, чем заменить непонятную.
    await seedSync();
    remote.chunks = [{ chunk: 0, ciphertext: 'неважно' }];
    remoteManifest = null;

    await pushAccountSnapshot();
    expect(putCalls).toBe(1);
  });
});
