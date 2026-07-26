// Приватность раздела «Женские дни» в резервных копиях.
//
// Настройка «включать раздел в копию» — единственное место, где человек сам
// решает, что уходит в облако. Раз так, она обязана переживать восстановление:
// настройка, которая сама себя отменяет, хуже отсутствующей — человек считает,
// что раздел закрыт, а он открыт.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const { db } = await import('./db');
const { exportBackup, importBackup } = await import('./backup');

const PRIVATE_SETTINGS = {
  id: 'app',
  lock: 'pin' as const,
  pin: 'хеш-кода',
  hideFromNavigation: true,
  includeInGeneralBackup: false,
};

async function seed() {
  await db.cycleSettings.put(PRIVATE_SETTINGS as never);
  await db.cycleDays.bulkPut([
    { date: '2026-01-01', bleeding: 'medium' },
    { date: '2026-01-02', bleeding: 'light' },
  ] as never[]);
  await db.cycleSymptoms.put({ key: 'свой', group: 'other', label: 'свой симптом' } as never);
}

describe('раздел «Женские дни» в копии', () => {
  beforeEach(async () => {
    await Promise.all([
      db.cycleSettings.clear(),
      db.cycleDays.clear(),
      db.cycleSymptoms.clear(),
      db.notes.clear(),
    ]);
    await seed();
  });

  it('выключенный раздел не кладёт в копию свои ДАННЫЕ', async () => {
    const file = await exportBackup();
    expect(file.data.cycleDays).toEqual([]);
  });

  it('выключенный раздел не кладёт в копию и НАСТРОЙКИ — ключа нет вовсе', async () => {
    // Именно ключа, а не пустого массива. Пустой массив importBackup понимает
    // как «очистить таблицу», и настройки стёрлись бы вместе с данными.
    const file = await exportBackup();
    expect('cycleSettings' in file.data).toBe(false);
    expect('cycleSymptoms' in file.data).toBe(false);
  });

  it('восстановление НЕ сбрасывает код доступа и настройку приватности', async () => {
    // Тот самый сценарий: человек запаролил раздел, спрятал из меню и выключил
    // из копий. Раньше любое восстановление стирало строку настроек, а раздел
    // заводил её заново с умолчаниями — без кода, снова в меню и снова в
    // облаке. Самоотменяющаяся приватность.
    const file = await exportBackup();
    await importBackup(file);

    const after = await db.cycleSettings.get('app');
    expect(after).toBeDefined();
    expect(after!.lock).toBe('pin');
    expect(after!.pin).toBe('хеш-кода');
    expect(after!.hideFromNavigation).toBe(true);
    expect(after!.includeInGeneralBackup).toBe(false);
  });

  it('свой симптом переживает восстановление', async () => {
    const file = await exportBackup();
    await importBackup(file);
    expect(await db.cycleSymptoms.get('свой')).toBeDefined();
  });

  it('данные раздела при этом действительно очищаются — так и задумано', async () => {
    // Обратная сторона той же настройки, и она НЕ дефект: «выключил и
    // восстановился» должно очищать раздел, иначе старые записи пережили бы
    // восстановление вопреки ожиданию. Тест держит границу между двумя
    // половинами, чтобы починка одной не поехала в другую.
    const file = await exportBackup();
    await importBackup(file);
    expect(await db.cycleDays.count()).toBe(0);
  });

  it('включённый раздел кладёт в копию всё, включая настройки', async () => {
    await db.cycleSettings.put({ ...PRIVATE_SETTINGS, includeInGeneralBackup: true } as never);
    const file = await exportBackup();
    expect(file.data.cycleDays).toHaveLength(2);
    expect(file.data.cycleSettings).toHaveLength(1);
  });
});
