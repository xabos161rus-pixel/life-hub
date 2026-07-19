import { addDays, format, getISODay, parse, startOfDay, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';

// Календарные даты в приложении — локальные строки 'YYYY-MM-DD'.
// Это исключает таймзонный баг: отметка в 23:30 МСК остаётся в своём дне.
export const DATE_KEY_FORMAT = 'yyyy-MM-dd';

export function toKey(d: Date): string {
  return format(d, DATE_KEY_FORMAT);
}

export function fromKey(key: string): Date {
  return startOfDay(parse(key, DATE_KEY_FORMAT, new Date()));
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDaysKey(key: string, days: number): string {
  return toKey(addDays(fromKey(key), days));
}

/** Понедельник недели, в которую входит дата. */
export function weekStartKey(key: string): string {
  return toKey(startOfWeek(fromKey(key), { weekStartsOn: 1 }));
}

/** День недели по ISO: 1=Пн … 7=Вс (совпадает с индексом WEEKDAY_LABELS + 1). */
export function isoWeekday(key: string): number {
  return getISODay(fromKey(key));
}

/** «11 июня», «11 июня 2027» и т.п. */
export function formatRu(key: string, fmt = 'd MMMM'): string {
  return format(fromKey(key), fmt, { locale: ru });
}

/** Заголовок «Сегодня»: «Четверг, 12 июня». */
export function formatHeaderDate(d: Date = new Date()): string {
  const s = format(d, 'EEEE, d MMMM', { locale: ru });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']; // index = isoDay - 1

/** Человекочитаемая дата срока: Сегодня / Завтра / Вчера / «18 июня». */
export function formatDueDate(key: string): string {
  const today = todayKey();
  if (key === today) return 'Сегодня';
  if (key === addDaysKey(today, 1)) return 'Завтра';
  if (key === addDaysKey(today, -1)) return 'Вчера';
  return formatRu(key);
}
