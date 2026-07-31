// Привычки по дням цикла: доля выполненного в дни менструации, в последние
// дни перед следующей менструацией и в остальные дни.
//
// Это ретроспективный вид, и только он. Никакой автоматики поверх этих чисел
// не строится сознательно: влияние фазы на работоспособность в исследованиях
// незначительно (McNulty 2020), а совет «сегодня не берись за сложное» —
// самосбывающееся пророчество. Показываем её собственные числа с количеством
// наблюдений — выводы человек делает сам.
//
// Окна нарочно крупные — три, а не шесть подфаз. Если перебрать шесть подфаз
// по каждой привычке на паре циклов данных, «закономерность» найдётся в чистом
// шуме (множественные сравнения). Крупные окна и общий счёт по всем привычкам —
// цена того, чтобы показанное было правдой.

import type { Cycle, LocalDate } from '../../db/cycleTypes';
import type { Habit, HabitLog } from '../../db/types';
import { isLogDone, isPlannedOn } from '../habits';
import { addDaysKey } from '../dates';

export type HabitsCycleWindow = 'period' | 'preMenstrual' | 'other';

export interface HabitsCycleRow {
  window: HabitsCycleWindow;
  /** Сколько пар «привычка × день» было запланировано в этом окне. */
  planned: number;
  done: number;
  /** done / planned, 0..1. */
  share: number;
}

export interface HabitsByCycle {
  /** Сколько завершённых циклов дало дни для расчёта. */
  cyclesUsed: number;
  /** Только окна, добравшие порог наблюдений, в порядке period → pre → other. */
  rows: HabitsCycleRow[];
}

/** Меньше этого запланированных отметок в окне — окно не показываем: доля из
 *  пяти наблюдений выглядит как факт, а является шумом. */
const MIN_PLANNED_PER_WINDOW = 10;
/** Минимум завершённых циклов. Один цикл — это не «по дням цикла», это «в тот
 *  месяц так вышло». */
const MIN_CYCLES = 2;
/** Последние N дней цикла считаются «перед менструацией». Пять — то же окно,
 *  которым исследование (M1) предлагает агрегировать, не деля на подфазы. */
const PRE_WINDOW_DAYS = 5;

const WINDOW_ORDER: HabitsCycleWindow[] = ['period', 'preMenstrual', 'other'];

/** Раскладывает дни завершённых неисключённых циклов по трём окнам и считает
 *  «запланировано/выполнено» по всем привычкам разом.
 *
 *  Правила честности счёта:
 *  - привычка участвует только с даты своего создания — иначе прошлые циклы
 *    записали бы ей провалы за время, когда её ещё не существовало;
 *  - берутся только живые неархивные привычки: у архивной нет способа узнать,
 *    в какие из прошлых дней она ещё была активна, и проще (и честнее для
 *    доли) не считать её вовсе, чем считать наполовину;
 *  - текущий незавершённый цикл не участвует: где у него окно «перед
 *    менструацией», станет известно только когда она начнётся. */
export function buildHabitsByCycle(
  habits: Habit[],
  logs: HabitLog[],
  cycles: Cycle[],
): HabitsByCycle | undefined {
  const activeHabits = habits.filter((h) => !h.deletedAt && h.archivedAt === null);
  if (activeHabits.length === 0) return undefined;

  const pool = cycles.filter(
    (c) => c.excluded === 0 && c.endDate !== undefined && c.lengthDays !== undefined,
  );
  if (pool.length < MIN_CYCLES) return undefined;

  // Выполненные дни по каждой привычке: живой лог на дату + добранная цель
  // для количественной. Ключ — id привычки.
  const doneByHabit = new Map<string, Set<LocalDate>>();
  for (const h of activeHabits) doneByHabit.set(h.id, new Set());
  for (const l of logs) {
    if (l.deletedAt) continue;
    const habit = activeHabits.find((h) => h.id === l.habitId);
    if (habit && isLogDone(habit, l.value)) doneByHabit.get(habit.id)!.add(l.date);
  }

  const totals: Record<HabitsCycleWindow, { planned: number; done: number }> = {
    period: { planned: 0, done: 0 },
    preMenstrual: { planned: 0, done: 0 },
    other: { planned: 0, done: 0 },
  };

  for (const cycle of pool) {
    const end = cycle.endDate!;
    const preStart = addDaysKey(end, -(PRE_WINDOW_DAYS - 1));
    for (let date = cycle.startDate; date <= end; date = addDaysKey(date, 1)) {
      // Менструация сильнее пред-окна: при коротком цикле окна могут
      // пересечься, и день должен попасть ровно в одно из них.
      const window: HabitsCycleWindow =
        cycle.periodEndDate !== undefined && date <= cycle.periodEndDate
          ? 'period'
          : date >= preStart
            ? 'preMenstrual'
            : 'other';

      for (const habit of activeHabits) {
        if (date < habit.createdAt.slice(0, 10)) continue;
        if (!isPlannedOn(habit.schedule, date)) continue;
        totals[window].planned += 1;
        if (doneByHabit.get(habit.id)!.has(date)) totals[window].done += 1;
      }
    }
  }

  const rows: HabitsCycleRow[] = WINDOW_ORDER.filter(
    (w) => totals[w].planned >= MIN_PLANNED_PER_WINDOW,
  ).map((w) => ({
    window: w,
    planned: totals[w].planned,
    done: totals[w].done,
    share: Math.round((100 * totals[w].done) / totals[w].planned) / 100,
  }));

  // Одно окно сравнивать не с чем: смысл вида — разница между окнами, а не
  // общий процент выполнения (он есть в самом разделе привычек).
  if (rows.length < 2) return undefined;

  return { cyclesUsed: pool.length, rows };
}
