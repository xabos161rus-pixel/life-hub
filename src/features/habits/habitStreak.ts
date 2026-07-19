import type { HabitSchedule } from '../../db/types';
import { addDaysKey, isoWeekday, todayKey, WEEKDAY_LABELS } from '../../lib/dates';

// Логика привычек — чистые функции над множеством дат-отметок (ключи 'YYYY-MM-DD').
// Даты-строки сравниваются лексикографически = хронологически (нулевые паддинги).

/** Запланирована ли привычка на этот день по её расписанию. */
export function isPlannedOn(schedule: HabitSchedule, key: string): boolean {
  switch (schedule.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return schedule.weekdays.includes(isoWeekday(key));
    // MVP не создаёт timesPerWeek; трактуем как ежедневно, чтобы не падать.
    case 'timesPerWeek':
      return true;
    default:
      return true;
  }
}

/** Человекочитаемая подпись расписания: «Каждый день» / «Пн, Ср, Пт». */
export function scheduleLabel(schedule: HabitSchedule): string {
  switch (schedule.type) {
    case 'daily':
      return 'Каждый день';
    case 'weekdays':
      if (schedule.weekdays.length >= 7) return 'Каждый день';
      if (schedule.weekdays.length === 0) return 'Не задано';
      return schedule.weekdays
        .slice()
        .sort((a, b) => a - b)
        .map((d) => WEEKDAY_LABELS[d - 1])
        .join(', ');
    case 'timesPerWeek':
      return `${schedule.times}× в неделю`;
    default:
      return '';
  }
}

export interface HabitStats {
  /** Текущая серия: последовательные выполненные запланированные дни до сегодня. */
  current: number;
  /** Рекордная серия за всю историю. */
  best: number;
  /** Отмечена ли привычка сегодня. */
  doneToday: boolean;
  /** Запланирована ли привычка на сегодня. */
  plannedToday: boolean;
}

/**
 * Считает серии по множеству выполненных дат.
 * Незапланированные дни серию не рвут и не наращивают. Сегодня без отметки
 * серию НЕ обрывает (день ещё не закончился), но и не засчитывается.
 */
export function habitStats(
  schedule: HabitSchedule,
  doneDates: Set<string>,
  today: string = todayKey(),
): HabitStats {
  const plannedToday = isPlannedOn(schedule, today);
  const doneToday = doneDates.has(today);

  if (doneDates.size === 0) {
    return { current: 0, best: 0, doneToday: false, plannedToday };
  }

  // Самая ранняя отметка — граница обхода (раньше неё серий быть не может).
  let earliest = today;
  for (const d of doneDates) if (d < earliest) earliest = d;

  // Текущая серия — идём назад от сегодня.
  let current = 0;
  let cursor = today;
  while (cursor >= earliest) {
    if (isPlannedOn(schedule, cursor)) {
      if (doneDates.has(cursor)) {
        current++;
      } else if (cursor !== today) {
        // Пропущенный запланированный день в прошлом — серия оборвалась.
        break;
      }
      // cursor === today без отметки — просто пропускаем, серию не рвём.
    }
    cursor = addDaysKey(cursor, -1);
  }

  // Рекорд — идём вперёд от первой отметки до сегодня.
  let best = 0;
  let run = 0;
  cursor = earliest;
  while (cursor <= today) {
    if (isPlannedOn(schedule, cursor)) {
      if (doneDates.has(cursor)) {
        run++;
        if (run > best) best = run;
      } else if (cursor !== today) {
        run = 0;
      }
    }
    cursor = addDaysKey(cursor, 1);
  }

  return { current, best, doneToday, plannedToday };
}
