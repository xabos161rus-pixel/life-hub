import { addDays, getISODay, subDays } from 'date-fns';
import type { Habit, HabitSchedule } from '../db/types';
import { fromKey, todayKey, toKey, weekStartKey } from './dates';

export function isScheduledOn(schedule: HabitSchedule, key: string): boolean {
  switch (schedule.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return schedule.weekdays.includes(getISODay(fromKey(key)));
    case 'timesPerWeek':
      return true; // отмечать можно в любой день
  }
}

function countInWeek(doneDates: Set<string>, anyKeyInWeek: string): number {
  const ws = fromKey(weekStartKey(anyKeyInWeek));
  let c = 0;
  for (let i = 0; i < 7; i++) {
    if (doneDates.has(toKey(addDays(ws, i)))) c++;
  }
  return c;
}

/** Отметок на неделе, в которую входит todayK (для «2 из 3 на этой неделе»). */
export function weekDoneCount(doneDates: Set<string>, todayK: string = todayKey()): number {
  return countInWeek(doneDates, todayK);
}

/**
 * Текущая серия. Для daily/weekdays — подряд выполненные дни по расписанию
 * (невыполненный «сегодня» серию не рвёт — день ещё не кончился).
 * Для timesPerWeek — подряд недели с нужным числом отметок (текущая неделя
 * засчитывается, когда норма уже выполнена, но серию не рвёт).
 */
export function currentStreak(habit: Habit, doneDates: Set<string>): number {
  const today = todayKey();

  if (habit.schedule.type === 'timesPerWeek') {
    const need = habit.schedule.times;
    let streak = 0;
    let weekKey = weekStartKey(today);
    if (countInWeek(doneDates, weekKey) >= need) streak++;
    weekKey = toKey(subDays(fromKey(weekKey), 7));
    while (countInWeek(doneDates, weekKey) >= need) {
      streak++;
      weekKey = toKey(subDays(fromKey(weekKey), 7));
    }
    return streak;
  }

  let streak = 0;
  let d = fromKey(today);
  if (doneDates.has(today)) streak++;
  d = subDays(d, 1);
  // 10 лет — практический предел глубины
  for (let i = 0; i < 3650; i++) {
    const key = toKey(d);
    if (!isScheduledOn(habit.schedule, key)) {
      d = subDays(d, 1);
      continue;
    }
    if (!doneDates.has(key)) break;
    streak++;
    d = subDays(d, 1);
  }
  return streak;
}

export interface HeatCell {
  date: string;
  done: boolean;
  scheduled: boolean;
  future: boolean;
}

/**
 * Матрица для мини-heatmap: weeks недель, каждая — 7 ячеек Пн..Вс,
 * последняя неделя — текущая.
 */
export function heatmapWeeks(
  habit: Habit,
  doneDates: Set<string>,
  weeks = 11,
): HeatCell[][] {
  const today = todayKey();
  const currentWeekStart = fromKey(weekStartKey(today));
  const result: HeatCell[][] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const ws = subDays(currentWeekStart, w * 7);
    const row: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const key = toKey(addDays(ws, i));
      row.push({
        date: key,
        done: doneDates.has(key),
        scheduled: isScheduledOn(habit.schedule, key),
        future: key > today,
      });
    }
    result.push(row);
  }
  return result;
}
