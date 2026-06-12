import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import type { HabitLog } from '../../db/types';

/**
 * Переключить отметку привычки на дату.
 * Уникальный индекс &[habitId+date] не позволяет держать вторую запись
 * на ту же дату, поэтому удалённый лог не пересоздаётся, а «воскрешается»
 * сбросом deletedAt — единственное оговорённое исключение из правил repo.
 */
export async function toggleHabitLog(habitId: string, date: string): Promise<void> {
  const existing = await db.habitLogs
    .where('[habitId+date]')
    .equals([habitId, date])
    .first();
  if (!existing) {
    await create(db.habitLogs, { habitId, date });
  } else if (!existing.deletedAt) {
    await remove(db.habitLogs, existing.id);
  } else {
    await update(db.habitLogs, existing.id, { deletedAt: null });
  }
}

/** Живые логи всех привычек (или одной, если передан habitId); [] пока грузится. */
export function useHabitLogs(habitId?: string): HabitLog[] {
  return (
    useLiveQuery(async () => {
      const rows = habitId
        ? await db.habitLogs.where('habitId').equals(habitId).toArray()
        : await db.habitLogs.toArray();
      return rows.filter((r) => !r.deletedAt);
    }, [habitId]) ?? []
  );
}
