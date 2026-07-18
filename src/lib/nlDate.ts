import { addDays, addMonths, addWeeks, getISODay, startOfDay, startOfWeek } from 'date-fns';
import { formatDueDate, toKey, todayKey } from './dates';
import type { Priority } from '../db/types';

// Лёгкий разбор естественной даты/времени из текста быстрого ввода задачи.
// «Позвонить маме завтра в 18:00» → title='Позвонить маме', dueDate=<завтра>, dueTime='18:00'.
// Плюс: «через 3 дня», «15 июня», «15.06», «в следующий понедельник», «вечером»,
// приоритет «!»/«!!»/«!!!» и теги «#дом». Распознаёт только однозначные русские
// конструкции; остальное оставляет в тексте.

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  tags: string[];
}

const WEEKDAYS: Record<string, number> = {
  понедельник: 1, пн: 1,
  вторник: 2, вт: 2,
  среда: 3, среду: 3, ср: 3,
  четверг: 4, чт: 4,
  пятница: 5, пятницу: 5, пт: 5,
  суббота: 6, субботу: 6, сб: 6,
  воскресенье: 7, вс: 7,
};

// Месяцы в родительном падеже («15 июня»), индекс 0-11 для new Date().
const MONTHS: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5,
  июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
};

// Части дня → час по умолчанию (если явное время не указано).
const DAY_PARTS: Record<string, string> = {
  утром: '09:00',
  днём: '14:00',
  днем: '14:00',
  вечером: '19:00',
  ночью: '22:00',
};

/** Ближайшая будущая дата с заданным ISO-днём недели (1=Пн..7=Вс). */
function nextWeekday(target: number): string {
  const today = startOfDay(new Date());
  const cur = getISODay(today);
  let delta = (target - cur + 7) % 7;
  if (delta === 0) delta = 7; // тот же день — берём через неделю
  return toKey(addDays(today, delta));
}

/** День недели на СЛЕДУЮЩЕЙ календарной неделе («в следующий понедельник»). */
function weekdayNextWeek(target: number): string {
  const monday = startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 });
  return toKey(addDays(monday, 7 + (target - 1)));
}

/** Конкретная дата: прошедшая в этом году → следующий год. */
function explicitDate(day: number, monthIdx: number, year: number | null): string | null {
  if (day < 1 || day > 31 || monthIdx < 0 || monthIdx > 11) return null;
  const today = startOfDay(new Date());
  let d = new Date(year ?? today.getFullYear(), monthIdx, day);
  if (d.getDate() !== day) return null; // 31 февраля и т.п.
  if (year == null && d < today) d = new Date(today.getFullYear() + 1, monthIdx, day);
  return toKey(d);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseQuickTask(raw: string): ParsedTask {
  let text = ` ${raw} `;
  let dueDate: string | null = null;
  let dueTime: string | null = null;
  let priority: Priority = 0;
  const tags: string[] = [];

  const cut = (re: RegExp) => {
    const m = text.match(re);
    if (m) text = text.replace(m[0], ' ');
    return m;
  };

  // Границы слов через пробельный lookahead — \b в JS не работает с кириллицей.
  // Текст обёрнут пробелами по краям, распознанные токены заменяются пробелом.

  // Теги: все «#слово».
  for (;;) {
    const m = cut(/\s#([^\s#]+)(?=\s)/);
    if (!m) break;
    tags.push(m[1]);
  }

  // Приоритет: «!»=низкий, «!!»=средний, «!!!»=высокий (отдельным словом).
  const prioM = cut(/\s(!{1,3})(?=\s)/);
  if (prioM) priority = Math.min(3, prioM[1].length) as Priority;

  // Время: «в 18:00», «18:30», иначе «в 9» → 09:00.
  // Разделитель — только двоеточие: точка осталась бы неотличима от
  // десятичных чисел («2.50 кг» → ложно 02:50 и порча заголовка).
  const timeM = cut(/\s(?:в\s)?(\d{1,2}):(\d{2})(?=\s)/i);
  if (timeM) {
    const h = Math.min(23, parseInt(timeM[1], 10));
    const mm = Math.min(59, parseInt(timeM[2], 10));
    dueTime = `${pad2(h)}:${pad2(mm)}`;
  } else {
    const hourM = cut(/\sв\s(\d{1,2})(?:\s(утра|дня|вечера|ночи))?(?=\s)/i);
    if (hourM) {
      let h = parseInt(hourM[1], 10);
      const suffix = hourM[2]?.toLowerCase();
      if ((suffix === 'вечера' || suffix === 'дня') && h < 12) h += 12; // «в 7 вечера» → 19:00
      if (h >= 0 && h <= 23) dueTime = `${pad2(h)}:00`;
    }
  }

  // «Через N …» / «через неделю/месяц» — раньше остальных дат.
  const today = () => startOfDay(new Date());
  const relM = cut(/\sчерез\s(\d+)?\s?(день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев)(?=\s)/i);
  if (relM) {
    const n = relM[1] ? parseInt(relM[1], 10) : 1;
    const unit = relM[2].toLowerCase();
    if (unit.startsWith('д')) dueDate = toKey(addDays(today(), n));
    else if (unit.startsWith('н')) dueDate = toKey(addWeeks(today(), n));
    else dueDate = toKey(addMonths(today(), n));
  }

  // Конкретные даты: «15 июня [2027]», «15.06[.2027]». Вырезаем из текста
  // ТОЛЬКО валидную дату — иначе «2.50 кг» потерял бы «2.50» из заголовка.
  if (!dueDate) {
    const m = text.match(/\s(\d{1,2})\s(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s(\d{4}))?(?=\s)/i);
    if (m) {
      const d = explicitDate(parseInt(m[1], 10), MONTHS[m[2].toLowerCase()], m[3] ? parseInt(m[3], 10) : null);
      if (d) {
        dueDate = d;
        text = text.replace(m[0], ' ');
      }
    }
  }
  if (!dueDate) {
    const m = text.match(/\s(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?=\s)/);
    if (m) {
      const d = explicitDate(parseInt(m[1], 10), parseInt(m[2], 10) - 1, m[3] ? parseInt(m[3], 10) : null);
      if (d) {
        dueDate = d;
        text = text.replace(m[0], ' ');
      }
    }
  }

  // Относительные дни (послезавтра — раньше завтра, иначе «завтра» съест начало)
  if (!dueDate) {
    if (cut(/\sсегодня(?=\s)/i)) {
      dueDate = todayKey();
    } else if (cut(/\sпослезавтра(?=\s)/i)) {
      dueDate = toKey(addDays(today(), 2));
    } else if (cut(/\sзавтра(?=\s)/i)) {
      dueDate = toKey(addDays(today(), 1));
    } else {
      // «В следующий понедельник» — до простых дней недели, иначе
      // «понедельник» распознался бы без «следующий» (ближайший, не тот).
      for (const [word, iso] of Object.entries(WEEKDAYS)) {
        const re = new RegExp(`\\s(?:в\\s|во\\s)?следующ(?:ий|ую|ее)\\s${word}(?=\\s)`, 'i');
        if (re.test(text)) {
          cut(re);
          dueDate = weekdayNextWeek(iso);
          break;
        }
      }
    }
    if (!dueDate) {
      // Дни недели (с опциональным предлогом «в»/«во»)
      for (const [word, iso] of Object.entries(WEEKDAYS)) {
        const re = new RegExp(`\\s(?:в\\s|во\\s)?${word}(?=\\s)`, 'i');
        if (re.test(text)) {
          cut(re);
          dueDate = nextWeekday(iso);
          break;
        }
      }
    }
  }

  // Части дня — как время по умолчанию; без даты означают «сегодня».
  if (!dueTime) {
    for (const [word, time] of Object.entries(DAY_PARTS)) {
      const re = new RegExp(`\\s${word}(?=\\s)`, 'i');
      if (re.test(text)) {
        cut(re);
        dueTime = time;
        if (!dueDate) dueDate = todayKey();
        break;
      }
    }
  }

  const title = text.replace(/\s+/g, ' ').trim();
  return {
    title: title || raw.trim(),
    dueDate,
    dueTime: dueDate ? dueTime : null,
    priority,
    tags,
  };
}

const PRIORITY_HINT: Record<Priority, string> = { 0: '', 1: '!низкий', 2: '!!средний', 3: '!!!высокий' };

/** Короткая подсказка под полем быстрого ввода — что распознано. */
export function describeParsed(p: ParsedTask): string | null {
  const parts: string[] = [];
  if (p.dueDate) {
    const label = formatDueDate(p.dueDate);
    parts.push(label.charAt(0).toLowerCase() + label.slice(1));
    if (p.dueTime) parts.push(`в ${p.dueTime}`);
  }
  if (p.priority > 0) parts.push(PRIORITY_HINT[p.priority]);
  for (const tag of p.tags) parts.push(`#${tag}`);
  return parts.length ? parts.join(' · ') : null;
}
