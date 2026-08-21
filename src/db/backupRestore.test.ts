// Что происходит с синхронизацией после восстановления из копии.
//
// Восстановление стирает таблицы и кладёт строки из снапшота с их исходными
// временами. Если курсоры обмена оставить на месте, всё, что появилось после
// снятия копии, на это устройство не вернётся никогда — сервер отдаёт только
// то, что новее курсора. А восстановленные строки старше lastPushAt и не
// уедут на второе устройство.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { importBackup, exportBackup } from './backup';
import { getSyncConfig } from '../lib/syncState';
import { generateKey } from '../lib/crypto';

async function seedSyncConfig(cursors: { lastPullAt: string; lastPushAt: string }) {
  await db.sync.put({
    id: 'config',
    accountId: 'acc-1',
    authToken: 'tok-1',
    key: await generateKey(),
    enabled: true,
    lastSyncedAt: '2026-08-20T10:00:00.000Z',
    ...cursors,
  } as never);
}

describe('восстановление из копии и синхронизация', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('сбрасывает оба курсора — иначе данные после снапшота теряются навсегда', async () => {
    await seedSyncConfig({
      lastPullAt: '2026-08-20T10:00:00.000Z|x',
      lastPushAt: '2026-08-20T10:00:00.000Z',
    });
    const backup = await exportBackup();

    await importBackup(backup);

    const c = await getSyncConfig();
    expect(c?.lastPullAt).toBe('');
    expect(c?.lastPushAt).toBe('');
    // Остальное в настройках обмена не тронуто — устройство остаётся
    // подключённым к тому же аккаунту.
    expect(c?.accountId).toBe('acc-1');
    expect(c?.enabled).toBe(true);
  });

  it('без настроенной синхронизации восстановление проходит как обычно', async () => {
    const backup = await exportBackup();
    await expect(importBackup(backup)).resolves.toBeUndefined();
    expect(await getSyncConfig()).toBeUndefined();
  });

  it('данные из копии на месте — сброс курсоров ничего не сломал', async () => {
    await db.tasks.put({
      id: 't1', title: 'Забрать колёса', done: false,
      createdAt: '2026-08-19T10:00:00.000Z', updatedAt: '2026-08-19T10:00:00.000Z', deletedAt: null,
    } as never);
    const backup = await exportBackup();
    await db.tasks.clear();
    await seedSyncConfig({ lastPullAt: 'x', lastPushAt: 'y' });

    await importBackup(backup);

    expect((await db.tasks.get('t1'))?.title).toBe('Забрать колёса');
  });
});
