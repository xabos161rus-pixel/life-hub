import type { EnergyLevel, EnergyLog } from '../db/types';
import { addDaysKey, isoWeekday, todayKey } from './dates';

// Логика дневника энергии — чистые функции над отметками (ключи 'YYYY-MM-DD').
// Главное правило всего файла: день без отметки — «нет данных», а не ноль.
// Поэтому среднее считается только по фактическим отметкам, а количество
// наблюдений (n) возвращается вместе с каждым числом: 4.5 по двум дням и
// 4.5 по двадцати — разные утверждения, и человек должен видеть, какое перед ним.

/** Подписи уровней. Якорные — 1, 3 и 5: шкала описывает не настроение,
 *  а способность работать, иначе отметки плывут от недели к неделе. */
export const ENERGY_LABEL: Record<EnergyLevel, string> = {
  1: 'Еле держусь',
  2: 'Тяжеловато',
  3: 'Рабочий режим',
  4: 'Хорошо',
  5: 'Прёт',
};

export const ENERGY_LEVELS: EnergyLevel[] = [1, 2, 3, 4, 5];

/** Ниже этого числа отметок аналитика не показывается: на пяти точках
 *  «тренд» — это шум, который выглядит как знание. */
export const ENOUGH_MARKS = 7;

/** Отметки в карту «дата → уровень». Ожидает уже отфильтрованные alive()
 *  записи; при дублях по дате (теоретически невозможных из-за &date)
 *  побеждает более поздняя по updatedAt — как при разрешении конфликтов синка. */
export function levelByDate(logs: EnergyLog[]): Map<string, EnergyLevel> {
  const m = new Map<string, EnergyLevel>();
  const seen = new Map<string, string>();
  for (const l of logs) {
    const prev = seen.get(l.date);
    if (prev !== undefined && prev >= l.updatedAt) continue;
    seen.set(l.date, l.updatedAt);
    m.set(l.date, l.level);
  }
  return m;
}

/** Даты окна [today-(days-1) … today], от старых к свежим. */
export function windowDates(today: string, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDaysKey(today, -i));
  return out;
}

export interface Average {
  /** null — в окне нет ни одной отметки. */
  avg: number | null;
  /** Сколько дней окна реально отмечено. */
  n: number;
}

function averageOver(byDate: Map<string, EnergyLevel>, dates: string[]): Average {
  let sum = 0;
  let n = 0;
  for (const d of dates) {
    const lvl = byDate.get(d);
    if (lvl !== undefined) {
      sum += lvl;
      n++;
    }
  }
  return { avg: n === 0 ? null : sum / n, n };
}

export interface Trend {
  current: Average;
  previous: Average;
  /** Разница средних; null, если хотя бы в одном окне нет отметок —
   *  «стало лучше» относительно пустоты не бывает. */
  delta: number | null;
}

/** Последние 7 дней против предыдущих 7. */
export function weekTrend(byDate: Map<string, EnergyLevel>, today: string = todayKey()): Trend {
  const current = averageOver(byDate, windowDates(today, 7));
  const previous = averageOver(byDate, windowDates(addDaysKey(today, -7), 7));
  const delta =
    current.avg === null || previous.avg === null ? null : current.avg - previous.avg;
  return { current, previous, delta };
}

export interface DayPoint {
  date: string;
  /** null — день без отметки; рисуется пропуском, а не нулём. */
  level: EnergyLevel | null;
}

/** Точки для спарклайна: 28 дней от старых к свежим, включая пропуски. */
export function dailyPoints(
  byDate: Map<string, EnergyLevel>,
  today: string = todayKey(),
  days = 28,
): DayPoint[] {
  return windowDates(today, days).map((date) => ({ date, level: byDate.get(date) ?? null }));
}

export interface WeekdayAverage extends Average {
  /** ISO: 1=Пн … 7=Вс. */
  weekday: number;
}

/** Средняя энергия по дням недели за окно. Смысл — увидеть провалы,
 *  привязанные к расписанию (у ночных смен они именно такие), а не к настроению. */
export function byWeekday(
  byDate: Map<string, EnergyLevel>,
  today: string = todayKey(),
  days = 28,
): WeekdayAverage[] {
  const buckets = new Map<number, string[]>();
  for (const d of windowDates(today, days)) {
    const wd = isoWeekday(d);
    const list = buckets.get(wd);
    if (list) list.push(d);
    else buckets.set(wd, [d]);
  }
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    ...averageOver(byDate, buckets.get(weekday) ?? []),
  }));
}

export interface LevelSplit {
  /** Дни с энергией 1–2. */
  low: Average;
  /** Дни с энергией 4–5. */
  high: Average;
}

/**
 * Делит дневную метрику (доля выполненных привычек, число закрытых задач…)
 * на дни низкой и высокой энергии. Середина (3) намеренно не участвует:
 * сравниваются полюса, иначе разница размазывается и ничего не показывает.
 * avg здесь — среднее самой метрики, n — сколько дней попало в группу.
 */
export function splitByLevel(
  byDate: Map<string, EnergyLevel>,
  samples: Map<string, number>,
): LevelSplit {
  let lowSum = 0;
  let lowN = 0;
  let highSum = 0;
  let highN = 0;
  for (const [date, value] of samples) {
    const lvl = byDate.get(date);
    if (lvl === undefined) continue; // день без отметки в связку не идёт
    if (lvl <= 2) {
      lowSum += value;
      lowN++;
    } else if (lvl >= 4) {
      highSum += value;
      highN++;
    }
  }
  return {
    low: { avg: lowN === 0 ? null : lowSum / lowN, n: lowN },
    high: { avg: highN === 0 ? null : highSum / highN, n: highN },
  };
}

/** Хватает ли отметок, чтобы показывать аналитику. */
export function hasEnoughMarks(byDate: Map<string, EnergyLevel>): boolean {
  return byDate.size >= ENOUGH_MARKS;
}
