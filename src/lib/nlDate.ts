import { addDays, getISODay, startOfDay } from 'date-fns';
import { toKey, todayKey } from './dates';

// Лёгкий разбор естественной даты/времени из текста быстрого ввода задачи.
// «Позвонить маме завтра в 18:00» → title='Позвонить маме', dueDate=<завтра>, dueTime='18:00'.
// Распознаёт только однозначные русские конструкции; остальное оставляет в тексте.

export interface ParsedTask {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
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

/** Ближайшая будущая дата с заданным ISO-днём недели (1=Пн..7=Вс). */
function nextWeekday(target: number): string {
  const today = startOfDay(new Date());
  const cur = getISODay(today);
  let delta = (target - cur + 7) % 7;
  if (delta === 0) delta = 7; // тот же день — берём через неделю
  return toKey(addDays(today, delta));
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function parseQuickTask(raw: string): ParsedTask {
  let text = ` ${raw} `;
  let dueDate: string | null = null;
  let dueTime: string | null = null;

  const cut = (re: RegExp) => {
    const m = text.match(re);
    if (m) text = text.replace(m[0], ' ');
    return m;
  };

  // Границы слов через пробельный lookahead — \b в JS не работает с кириллицей.
  // Текст обёрнут пробелами по краям, распознанные токены заменяются пробелом.

  // Время: «в 18:00», «18:30», иначе «в 9» → 09:00
  const timeM = cut(/\s(?:в\s)?(\d{1,2})[:.](\d{2})(?=\s)/i);
  if (timeM) {
    const h = Math.min(23, parseInt(timeM[1], 10));
    const mm = Math.min(59, parseInt(timeM[2], 10));
    dueTime = `${pad2(h)}:${pad2(mm)}`;
  } else {
    const hourM = cut(/\sв\s(\d{1,2})(?=\s)/i);
    if (hourM) {
      const h = parseInt(hourM[1], 10);
      if (h >= 0 && h <= 23) dueTime = `${pad2(h)}:00`;
    }
  }

  // Относительные дни (послезавтра — раньше завтра, иначе «завтра» съест начало)
  if (cut(/\sсегодня(?=\s)/i)) {
    dueDate = todayKey();
  } else if (cut(/\sпослезавтра(?=\s)/i)) {
    dueDate = toKey(addDays(startOfDay(new Date()), 2));
  } else if (cut(/\sзавтра(?=\s)/i)) {
    dueDate = toKey(addDays(startOfDay(new Date()), 1));
  } else {
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

  const title = text.replace(/\s+/g, ' ').trim();
  return { title: title || raw.trim(), dueDate, dueTime: dueDate ? dueTime : null };
}

/** Короткая подсказка под полем быстрого ввода — что распознано. */
export function describeParsed(p: ParsedTask): string | null {
  if (!p.dueDate) return null;
  const parts: string[] = [];
  const t = todayKey();
  if (p.dueDate === t) parts.push('сегодня');
  else parts.push(p.dueDate);
  if (p.dueTime) parts.push(`в ${p.dueTime}`);
  return parts.join(' ');
}
