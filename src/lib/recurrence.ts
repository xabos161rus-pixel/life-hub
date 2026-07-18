import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
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
import { plural } from './plural';

/**
 * Следующая дата повторяющейся задачи после её выполнения.
 * Результат не раньше, чем «после сегодня» (просроченная задача не плодит
 * хвост прошлых повторений), но фаза цикла всегда привязана к исходному
 * сроку (anchor) — иначе при interval>1 просрочка сбивала бы кадэнс.
 */
export function nextOccurrence(rec: Recurrence, dueKey: string | null): string {
  const today = startOfDay(new Date());
  const after = dueKey ? max([fromKey(dueKey), today]) : today;
  const anchor = dueKey ? fromKey(dueKey) : today;

  switch (rec.type) {
    case 'daily': {
      const step = Math.max(1, rec.interval);
      let d = addDays(anchor, step);
      while (d <= after) d = addDays(d, step);
      return toKey(d);
    }

    case 'weekly': {
      const step = Math.max(1, rec.interval);
      const days = [...rec.weekdays].sort((a, b) => a - b);
      if (days.length === 0) {
        let d = addWeeks(anchor, step);
        while (d <= after) d = addWeeks(d, step);
        return toKey(d);
      }
      // Идём по неделям кадэнса (anchor + k·interval) и берём первый
      // выбранный день недели строго после `after`.
      let weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
      for (let i = 0; i < 520; i++) {
        for (const d of days) {
          const cand = addDays(weekStart, d - 1);
          if (cand > after) return toKey(cand);
        }
        weekStart = addWeeks(weekStart, step);
      }
      return toKey(addDays(weekStart, days[0] - 1));
    }

    case 'monthly': {
      const step = Math.max(1, rec.interval);
      const clampDay = (m: Date) => Math.min(rec.dayOfMonth, getDaysInMonth(m));
      let m = startOfMonth(anchor);
      for (let i = 0; i < 600; i++) {
        const cand = setDate(m, clampDay(m));
        if (cand > after) return toKey(cand);
        m = addMonths(m, step);
      }
      return toKey(setDate(m, clampDay(m)));
    }

    case 'yearly': {
      // Год от исходной даты; 29 февраля date-fns сам прижимает к 28-му.
      const step = Math.max(1, rec.interval);
      let d = addYears(anchor, step);
      while (d <= after) d = addYears(d, step);
      return toKey(d);
    }
  }
}

/** Краткое описание для UI: «Каждый день», «По Пн, Ср», «5-го числа». */
export function describeRecurrence(rec: Recurrence): string {
  switch (rec.type) {
    case 'daily':
      return rec.interval === 1
        ? 'Каждый день'
        : `${plural(rec.interval, ['Каждый', 'Каждые', 'Каждые'])} ${rec.interval} ${plural(rec.interval, ['день', 'дня', 'дней'])}`;
    case 'weekly': {
      const days = [...rec.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d - 1]);
      const prefix =
        rec.interval === 1
          ? ''
          : `${plural(rec.interval, ['Каждую', 'Каждые', 'Каждые'])} ${rec.interval} ${plural(rec.interval, ['неделю', 'недели', 'недель'])} `;
      return days.length ? `${prefix}По ${days.join(', ')}` : `${prefix}Еженедельно`;
    }
    case 'monthly':
      return rec.interval === 1
        ? `${rec.dayOfMonth}-го числа`
        : `${rec.dayOfMonth}-го числа, раз в ${rec.interval} мес.`;
    case 'yearly':
      return rec.interval === 1
        ? 'Каждый год'
        : `${plural(rec.interval, ['Каждый', 'Каждые', 'Каждые'])} ${rec.interval} ${plural(rec.interval, ['год', 'года', 'лет'])}`;
  }
}

/** Дата начала ISO-дня недели в getISODay-семантике, реэкспорт для удобства фич. */
export { getISODay };
