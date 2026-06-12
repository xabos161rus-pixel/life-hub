import {
  addDays,
  addMonths,
  addWeeks,
  getDaysInMonth,
  getISODay,
  max,
  setDate,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { Recurrence } from '../db/types';
import { fromKey, toKey, WEEKDAY_LABELS } from './dates';

/**
 * Следующая дата повторяющейся задачи после её выполнения.
 * База — максимум из срока и сегодняшнего дня: просроченная задача
 * не плодит «хвост» прошлых повторений.
 */
export function nextOccurrence(rec: Recurrence, dueKey: string | null): string {
  const today = startOfDay(new Date());
  const base = dueKey ? max([fromKey(dueKey), today]) : today;

  switch (rec.type) {
    case 'daily':
      return toKey(addDays(base, Math.max(1, rec.interval)));

    case 'weekly': {
      const days = [...rec.weekdays].sort((a, b) => a - b);
      if (days.length === 0) return toKey(addWeeks(base, Math.max(1, rec.interval)));
      const baseWeek = startOfWeek(base, { weekStartsOn: 1 });
      // ближайший выбранный день в текущей неделе, строго после base
      for (const d of days) {
        const cand = addDays(baseWeek, d - 1);
        if (cand > base) return toKey(cand);
      }
      // иначе — первый выбранный день через interval недель
      const nextWeek = addWeeks(baseWeek, Math.max(1, rec.interval));
      return toKey(addDays(nextWeek, days[0] - 1));
    }

    case 'monthly': {
      const clampDay = (m: Date) => Math.min(rec.dayOfMonth, getDaysInMonth(m));
      const sameMonth = setDate(startOfMonth(base), clampDay(base));
      if (sameMonth > base) return toKey(sameMonth);
      const nextMonth = addMonths(startOfMonth(base), Math.max(1, rec.interval));
      return toKey(setDate(nextMonth, clampDay(nextMonth)));
    }
  }
}

/** Краткое описание для UI: «Каждый день», «По Пн, Ср», «5-го числа». */
export function describeRecurrence(rec: Recurrence): string {
  switch (rec.type) {
    case 'daily':
      return rec.interval === 1 ? 'Каждый день' : `Каждые ${rec.interval} дн.`;
    case 'weekly': {
      const days = [...rec.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d - 1]);
      const prefix = rec.interval === 1 ? '' : `Каждые ${rec.interval} нед. `;
      return days.length ? `${prefix}По ${days.join(', ')}` : `${prefix}Еженедельно`;
    }
    case 'monthly':
      return rec.interval === 1
        ? `${rec.dayOfMonth}-го числа`
        : `${rec.dayOfMonth}-го числа, раз в ${rec.interval} мес.`;
  }
}

/** Дата начала ISO-дня недели в getISODay-семантике, реэкспорт для удобства фич. */
export { getISODay };
