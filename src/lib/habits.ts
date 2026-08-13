import type { Habit, HabitLog, HabitSchedule } from '../db/types';
import { addDaysKey, isoWeekday, todayKey, WEEKDAY_LABELS } from './dates';
import { t } from './i18n';

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

/** Заморожена ли привычка в этот конкретный день: date попадает в один из
 *  интервалов frozenRanges (открытый интервал без to считается бесконечным
 *  «сейчас и дальше»). */
export function isFrozenOn(habit: Habit, date: string): boolean {
  const ranges = habit.frozenRanges;
  if (!ranges || ranges.length === 0) return false;
  return ranges.some((r) => r.from <= date && (r.to === undefined || date <= r.to));
}

/** Есть ли у привычки открытая заморозка прямо сейчас (интервал без to). */
export function isFrozenNow(habit: Habit): boolean {
  return (habit.frozenRanges ?? []).some((r) => r.to === undefined);
}

/** Единая точка «этот день считается»: запланирован по расписанию И не
 *  заморожен. Именно на неё опираются серии — заморозка не рвёт стрик,
 *  ровно как непланируемый по расписанию день не рвёт его. */
export function isActiveOn(habit: Habit, date: string): boolean {
  return isPlannedOn(habit.schedule, date) && !isFrozenOn(habit, date);
}

/** Человекочитаемая подпись расписания: «Каждый день» / «Пн, Ср, Пт». */
export function scheduleLabel(schedule: HabitSchedule): string {
  switch (schedule.type) {
    case 'daily':
      return t('Каждый день');
    case 'weekdays':
      if (schedule.weekdays.length >= 7) return t('Каждый день');
      if (schedule.weekdays.length === 0) return t('Не задано');
      return schedule.weekdays
        .slice()
        .sort((a, b) => a - b)
        .map((d) => t(WEEKDAY_LABELS[d - 1]))
        .join(', ');
    case 'timesPerWeek':
      return t('{n}× в неделю', { n: schedule.times });
    default:
      return '';
  }
}

/** Выполнена ли привычка в день с этим значением лога. Для простой (target==null)
 *  сам факт живого лога = выполнено; для количественной нужно добрать до цели. */
export function isLogDone(habit: Habit, value: number | null): boolean {
  if (habit.target == null) return true;
  return (value ?? 0) >= habit.target;
}

/** Множество дат, где привычка считается выполненной (по её типу).
 *  logs — живые логи именно этой привычки. */
export function doneDates(habit: Habit, logs: HabitLog[]): Set<string> {
  const s = new Set<string>();
  for (const l of logs) if (isLogDone(habit, l.value)) s.add(l.date);
  return s;
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
  /** Сколько замороженных, но запланированных по расписанию дней перекрыто
   *  окном текущей серии (от календарного дня её начала до сегодня). Честность
   *  напоказ: «серия 47, в ней заморозка 12 дней» — не значит, что все 47
   *  выполнены руками. 0, если серия нулевая или заморозок в ней не было. */
  frozenInCurrent: number;
}

/**
 * Считает серии по множеству выполненных дат.
 * Незапланированные и замороженные дни (isActiveOn=false) серию не рвут и не
 * наращивают — заморозка живёт по той же логике расписаний, что и обычный
 * непланируемый день. Сегодня без отметки серию НЕ обрывает (день ещё не
 * закончился), но и не засчитывается.
 */
export function habitStats(
  habit: Habit,
  done: Set<string>,
  today: string = todayKey(),
): HabitStats {
  const plannedToday = isPlannedOn(habit.schedule, today);
  const doneToday = done.has(today);

  if (done.size === 0) {
    return { current: 0, best: 0, doneToday: false, plannedToday, frozenInCurrent: 0 };
  }

  // Самая ранняя отметка — граница обхода (раньше неё серий быть не может).
  let earliest = today;
  for (const d of done) if (d < earliest) earliest = d;

  // Текущая серия — идём назад от сегодня. streakStart запоминает самый ранний
  // календарный день, ещё попавший в окно серии (включая пропущенные по
  // расписанию/заморозке дни между отметками) — по нему считается frozenInCurrent.
  let current = 0;
  let cursor = today;
  let streakStart = today;
  while (cursor >= earliest) {
    if (isActiveOn(habit, cursor)) {
      if (done.has(cursor)) {
        current++;
      } else if (cursor !== today) {
        // Пропущенный активный день в прошлом — серия оборвалась.
        break;
      }
      // cursor === today без отметки — просто пропускаем, серию не рвём.
    }
    streakStart = cursor;
    cursor = addDaysKey(cursor, -1);
  }

  let frozenInCurrent = 0;
  if (current > 0) {
    let d = streakStart;
    while (d <= today) {
      if (isPlannedOn(habit.schedule, d) && isFrozenOn(habit, d)) frozenInCurrent++;
      d = addDaysKey(d, 1);
    }
  }

  // Рекорд — идём вперёд от первой отметки до сегодня.
  let best = 0;
  let run = 0;
  cursor = earliest;
  while (cursor <= today) {
    if (isActiveOn(habit, cursor)) {
      if (done.has(cursor)) {
        run++;
        if (run > best) best = run;
      } else if (cursor !== today) {
        run = 0;
      }
    }
    cursor = addDaysKey(cursor, 1);
  }

  return { current, best, doneToday, plannedToday, frozenInCurrent };
}
