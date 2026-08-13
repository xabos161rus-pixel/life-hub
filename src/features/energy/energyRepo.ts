import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import type { EnergyLevel } from '../../db/types';

function findLog(date: string) {
  // where().first() достаёт и мягко удалённую строку — она и нужна для
  // воскрешения: уникальный индекс &date не даст создать вторую на ту же дату.
  return db.energyLogs.where('date').equals(date).first();
}

/** Поставить (или изменить) отметку за день. */
export async function setEnergyLevel(date: string, level: EnergyLevel): Promise<void> {
  const existing = await findLog(date);
  if (existing) await update(db.energyLogs, existing.id, { level, deletedAt: null });
  else await create(db.energyLogs, { date, level });
}

/** Снять отметку за день — день снова становится «нет данных». */
export async function clearEnergyLevel(date: string): Promise<void> {
  const existing = await findLog(date);
  if (existing && !existing.deletedAt) await remove(db.energyLogs, existing.id);
}

/**
 * Тап по шкале: по выбранной точке — снять отметку, по другой — переставить.
 * Снятие важнее, чем кажется: ошибочный тап иначе не исправить, а «нет данных»
 * и «поставил тройку» — разные вещи для всей аналитики.
 */
export async function toggleEnergyLevel(
  date: string,
  level: EnergyLevel,
  current: EnergyLevel | null,
): Promise<void> {
  if (current === level) await clearEnergyLevel(date);
  else await setEnergyLevel(date, level);
}
