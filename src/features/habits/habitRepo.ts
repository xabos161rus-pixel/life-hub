import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';

/**
 * Отмечает/снимает выполнение привычки за конкретный день.
 *
 * У habitLogs уникальный индекс [habitId+date], а remove() — это soft-delete
 * (строка физически остаётся). Поэтому повторную отметку делаем «воскрешением»
 * уже существующего лога (deletedAt=null), а не вторым create — иначе дубль
 * по уникальному индексу. Так же корректно для синка (LWW по updatedAt).
 */
export async function setHabitDay(habitId: string, date: string, done: boolean): Promise<void> {
  const existing = await db.habitLogs.where('[habitId+date]').equals([habitId, date]).first();
  if (done) {
    if (!existing) {
      await create(db.habitLogs, { habitId, date });
    } else if (existing.deletedAt) {
      await update(db.habitLogs, existing.id, { deletedAt: null });
    }
  } else if (existing && !existing.deletedAt) {
    await remove(db.habitLogs, existing.id);
  }
}
