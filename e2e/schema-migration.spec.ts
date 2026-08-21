import { expect } from '@playwright/test';
import { openApp, test } from './fixtures';

// Переход на новую версию схемы не должен терять данные.
//
// v19 добавляет индекс updatedAt двадцати таблицам. Dexie при этом
// перестраивает индексы существующих таблиц — и если в определении версии
// забыть хоть один прежний индекс, он молча исчезнет, а вместе с ним сломаются
// запросы, которые на него опирались.

test('данные и прежние индексы переживают переход на новую схему', async ({ page }) => {
  await openApp(page, '/');

  const result = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const ts = new Date().toISOString();
    await db.tasks.put({
      id: 'keep-1', title: 'Забрать колёса', projectId: 'p1', dueDate: '2026-08-25',
      done: false, createdAt: ts, updatedAt: ts, deletedAt: null,
    } as never);
    await db.habitLogs.put({
      id: 'h-1', habitId: 'hab', date: '2026-08-21', updatedAt: ts, deletedAt: null,
    } as never);
    await db.energyLogs.put({ id: 'e-1', date: '2026-08-21', level: 4, updatedAt: ts, deletedAt: null } as never);

    return {
      version: db.verno,
      // Прежние индексы на месте: запросы по ним обязаны работать.
      byDue: (await db.tasks.where('dueDate').equals('2026-08-25').toArray()).length,
      byProject: (await db.tasks.where('projectId').equals('p1').toArray()).length,
      byHabitDate: (await db.habitLogs.where('[habitId+date]').equals(['hab', '2026-08-21']).toArray()).length,
      byEnergyDate: (await db.energyLogs.where('date').equals('2026-08-21').toArray()).length,
      // И новый индекс работает.
      byUpdated: (await db.tasks.where('updatedAt').between('2000-01-01', '2100-01-01', true, false).toArray()).length,
      task: (await db.tasks.get('keep-1'))?.title,
    };
  });

  expect(result.version).toBeGreaterThanOrEqual(19);
  expect(result.task).toBe('Забрать колёса');
  expect(result.byDue).toBe(1);
  expect(result.byProject).toBe(1);
  expect(result.byHabitDate).toBe(1);
  expect(result.byEnergyDate).toBe(1);
  expect(result.byUpdated).toBeGreaterThanOrEqual(1);
});

test('переход со старой базы с данными: записи и индексы на месте', async ({ page }) => {
  // Настоящий сценарий обновления: у Влада и семьи базы уже с историей.
  // Создаём базу прежней версии голым IndexedDB (Dexie здесь не нужен — важна
  // только версия и содержимое), кладём записи, и только потом пускаем
  // приложение, которое поднимет схему до текущей.
  await page.addInitScript(() => {
    (window as unknown as { __seedOld: () => Promise<void> }).__seedOld = () =>
      new Promise<void>((resolve, reject) => {
        // Dexie нумерует версии в IndexedDB десятикратно: схема 18 — это 180.
        const req = indexedDB.open('life-hub', 180);
        req.onupgradeneeded = () => {
          const idb = req.result;
          const tasks = idb.createObjectStore('tasks', { keyPath: 'id' });
          tasks.createIndex('projectId', 'projectId');
          tasks.createIndex('dueDate', 'dueDate');
          const logs = idb.createObjectStore('habitLogs', { keyPath: 'id' });
          logs.createIndex('[habitId+date]', ['habitId', 'date'], { unique: true });
        };
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(['tasks', 'habitLogs'], 'readwrite');
          tx.objectStore('tasks').put({
            id: 'old-1', title: 'Заметка из прошлой версии', projectId: 'p9',
            dueDate: '2026-08-30', updatedAt: '2026-08-01T10:00:00.000Z', deletedAt: null,
          });
          tx.objectStore('habitLogs').put({
            id: 'old-log', habitId: 'h9', date: '2026-08-01',
            updatedAt: '2026-08-01T10:00:00.000Z', deletedAt: null,
          });
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
  });

  // Статический файл того же источника: он не запускает приложение, поэтому
  // база на момент подготовки ещё не создана.
  await page.goto('/favicon.svg');
  await page.evaluate(() => (window as unknown as { __seedOld: () => Promise<void> }).__seedOld());

  // Теперь запускаем приложение — оно поднимет схему.
  await openApp(page, '/');

  const after = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    return {
      version: db.verno,
      task: (await db.tasks.get('old-1'))?.title,
      log: (await db.habitLogs.get('old-log'))?.habitId,
      byDue: (await db.tasks.where('dueDate').equals('2026-08-30').toArray()).length,
      byUpdated: (await db.tasks.where('updatedAt').between('2026-01-01', '2027-01-01', true, false).toArray()).length,
    };
  });

  expect(after.version).toBeGreaterThanOrEqual(19);
  // Данные прежней версии на месте.
  expect(after.task).toBe('Заметка из прошлой версии');
  expect(after.log).toBe('h9');
  // Прежний индекс работает, новый — построен по уже лежавшим записям.
  expect(after.byDue).toBe(1);
  expect(after.byUpdated).toBe(1);
});
