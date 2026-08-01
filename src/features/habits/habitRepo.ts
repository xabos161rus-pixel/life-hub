import { db } from '../../db/db';
import { alive, create, remove, update } from '../../db/repo';
import { addDaysKey, todayKey } from '../../lib/dates';
import { isFrozenNow } from '../../lib/habits';

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

// === Заморозка ===
// «Осознанно отложить без чувства вины» — тот же концепт, что заморозка задач,
// но привычка не просто прячется, а по-настоящему исключается из планирования
// (isActiveOn в lib/habits.ts): серия честно перешагивает эти дни, не считая
// их ни выполненными, ни провальными.

/** Заморозить привычку: если открытого интервала ещё нет — добавляем новый
 *  с today и указанным origin. Повторный вызов на уже открытой заморозке — no-op. */
export async function freezeHabit(
  id: string,
  origin: 'manual' | 'section' = 'manual',
): Promise<void> {
  const habit = await db.habits.get(id);
  if (!habit || isFrozenNow(habit)) return;
  const ranges = [...(habit.frozenRanges ?? []), { from: todayKey(), origin }];
  await update(db.habits, id, { frozenRanges: ranges });
}

/** Закрывает открытый интервал заморозки днём to = вчера — день разморозки
 *  уже планируется. Если заморозили и разморозили в один день (to < from) —
 *  интервал убираем целиком, следа в истории не остаётся. */
export async function unfreezeHabit(id: string): Promise<void> {
  const habit = await db.habits.get(id);
  if (!habit) return;
  const ranges = habit.frozenRanges ?? [];
  const openIdx = ranges.findIndex((r) => r.to === undefined);
  if (openIdx === -1) return;
  const to = addDaysKey(todayKey(), -1);
  const next =
    to < ranges[openIdx].from
      ? ranges.filter((_, i) => i !== openIdx)
      : ranges.map((r, i) => (i === openIdx ? { ...r, to } : r));
  await update(db.habits, id, { frozenRanges: next });
}

/** Выключение раздела «Привычки»: замораживает разом все живые незамороженные
 *  привычки с origin='section'. Тумблер раздела — это «выгорел, всё замолчи»,
 *  и серии не должны сгорать за отдых. */
export async function freezeAllForSection(): Promise<void> {
  const habits = alive(await db.habits.toArray()).filter((h) => !h.archivedAt);
  for (const h of habits) {
    if (isFrozenNow(h)) continue;
    await freezeHabit(h.id, 'section');
  }
}

/** Включение раздела «Привычки»: закрывает ТОЛЬКО открытые заморозки с
 *  origin='section'. Ручные заморозки (человек сам поставил на паузу) не
 *  трогаем — тумблер раздела не должен снимать чужое осознанное решение. */
export async function unfreezeSectionFrozen(): Promise<void> {
  const habits = alive(await db.habits.toArray());
  for (const h of habits) {
    const ranges = h.frozenRanges ?? [];
    const openIdx = ranges.findIndex((r) => r.to === undefined && r.origin === 'section');
    if (openIdx === -1) continue;
    const to = addDaysKey(todayKey(), -1);
    const next =
      to < ranges[openIdx].from
        ? ranges.filter((_, i) => i !== openIdx)
        : ranges.map((r, i) => (i === openIdx ? { ...r, to } : r));
    await update(db.habits, h.id, { frozenRanges: next });
  }
}
