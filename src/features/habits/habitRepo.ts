import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';

function findLog(habitId: string, date: string) {
  return db.habitLogs.where('[habitId+date]').equals([habitId, date]).first();
}

/**
 * Upsert значения отметки за день. У habitLogs уникальный индекс [habitId+date],
 * а remove() — soft-delete (строка остаётся), поэтому повторную отметку делаем
 * «воскрешением» существующего лога, а не вторым create. Корректно и для синка
 * (LWW по updatedAt). value=null — простая отметка-галочка.
 */
async function upsertLog(habitId: string, date: string, value: number | null): Promise<void> {
  const existing = await findLog(habitId, date);
  if (existing) {
    await update(db.habitLogs, existing.id, { value, deletedAt: null });
  } else {
    await create(db.habitLogs, { habitId, date, value });
  }
}

async function clearLog(habitId: string, date: string): Promise<void> {
  const existing = await findLog(habitId, date);
  if (existing && !existing.deletedAt) await remove(db.habitLogs, existing.id);
}

/** Простая привычка-галочка: отметить/снять день. */
export async function toggleHabitDone(habitId: string, date: string, done: boolean): Promise<void> {
  if (done) await upsertLog(habitId, date, null);
  else await clearLog(habitId, date);
}

/** Количественная привычка: записать значение за день (0 или меньше — снять отметку). */
export async function setHabitValue(habitId: string, date: string, value: number): Promise<void> {
  if (value > 0) await upsertLog(habitId, date, value);
  else await clearLog(habitId, date);
}
