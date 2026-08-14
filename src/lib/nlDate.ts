import { addDays, addMonths, addWeeks, getISODay, startOfDay, startOfWeek } from 'date-fns';
import { formatDueDate, toKey, todayKey } from './dates';
import { getLang, t } from './i18n';
import type { Priority } from '../db/types';

// Лёгкий разбор естественной даты/времени из текста быстрого ввода задачи.
// «Позвонить маме завтра в 18:00» → title='Позвонить маме', dueDate=<завтра>, dueTime='18:00'.
// Плюс: «через 3 дня», «15 июня», «15.06», «в следующий понедельник», «вечером»,
// приоритет «!»/«!!»/«!!!» и теги «#дом». Распознаёт только однозначные
// конструкции; остальное оставляет в тексте.
//
// Грамматика следует за языком интерфейса (getLang), не за языком текста:
// в EN-интерфейсе работает английская («tomorrow at 10», «in 3 days»,
// «June 15», «next monday»), в русском — русская. Смешение не угадываем:
// пользователь видит в подсказке, что распозналось, и язык меняет редко.

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

/** Единая точка разбора: грамматика выбирается по языку интерфейса. */
export function parseQuickTask(raw: string): ParsedTask {
  return getLang() === 'en' ? parseQuickTaskEn(raw) : parseQuickTaskRu(raw);
}

function parseQuickTaskRu(raw: string): ParsedTask {
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
      if (suffix === 'ночи' && h === 12) h = 0; // «в 12 ночи» → 00:00
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

  // Явное время без даты («позвонить в 18:00») — как части дня: значит сегодня.
  // Иначе время терялось бы: dueTime обнулялся при пустой дате (см. return).
  if (dueTime && !dueDate) dueDate = todayKey();

  const title = text.replace(/\s+/g, ' ').trim();
  return {
    title: title || raw.trim(),
    dueDate,
    dueTime: dueDate ? dueTime : null,
    priority,
    tags,
  };
}

// ---------------------------------------------------------------------------
// Английская грамматика. Зеркалит русскую по возможностям; отличия осознанны:
//  — числовая дата ТОЛЬКО через слэш «15/06» (день/месяц, порядок UK/AU/CA);
//    точечную «1.5» не берём — в EN точка это десятичный разделитель, и
//    «run 1.5 km» превратился бы в 1 мая. Американский порядок month/day
//    не делаем до подготовки US-фазы (решение из выписки i18n).
//  — части дня только предложные («in the morning», «at night», «tonight»):
//    голое «morning» — обычное существительное, «morning run» потерял бы слово.

const WEEKDAYS_EN: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

// «May» — ещё и модальный глагол: «review may 3 drafts» распознается как
// 3 мая. Осознанный компромисс: форма «may need 3…» датой не является
// (между словом и числом глагол), а разбор виден в подсказке под полем.
const MONTHS_EN: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

// Длинные имена раньше коротких, иначе «tuesday» распознался бы как «tue»+хвост.
const byLenDesc = (a: string, b: string) => b.length - a.length;
const WEEKDAY_ALT = Object.keys(WEEKDAYS_EN).sort(byLenDesc).join('|');
// Полные имена дней можно писать голыми («gym friday»), сокращения — только
// с предлогом («on fri», «this sat»): голые «sat»/«sun»/«wed» — обычные
// английские слова («buy sun cream»), без предлога они съедали бы слово из
// заголовка и назначали ложную дату. Полное имя — от шести букв («thurs» — 5).
const WEEKDAY_FULL_ALT = Object.keys(WEEKDAYS_EN).filter((w) => w.length >= 6).sort(byLenDesc).join('|');
const MONTH_ALT = Object.keys(MONTHS_EN).sort(byLenDesc).join('|');

const DAY_PARTS_EN: Record<string, string> = {
  morning: '09:00',
  afternoon: '14:00',
  evening: '19:00',
};

/** 12-часовое время в 24-часовое; час вне 1..12 — мусор, время не ставим. */
function from12h(h: number, suffix: string): number | null {
  if (h < 1 || h > 12) return null;
  if (suffix === 'am') return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

function parseQuickTaskEn(raw: string): ParsedTask {
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

  // Схема та же, что в русской ветке: текст обёрнут пробелами, распознанные
  // токены заменяются пробелом, границы слов — пробельный lookahead.

  for (;;) {
    const m = cut(/\s#([^\s#]+)(?=\s)/);
    if (!m) break;
    tags.push(m[1]);
  }

  const prioM = cut(/\s(!{1,3})(?=\s)/);
  if (prioM) priority = Math.min(3, prioM[1].length) as Priority;

  // Время: «at 18:30», «6:30pm», «at 6pm», «at 8 in the evening», «at 6» →
  // 06:00, «at noon»/«at midnight». Правило то же, что у дат ниже: вырезается
  // ТОЛЬКО валидное время — «at 13pm» и «99:30» остаются в тексте (это
  // опечатка, а не время; кламп придумал бы за человека то, чего он не писал).
  let bareHour = false; // голое «at 9» — утро или вечер? уточнит «tonight»
  {
    const m = text.match(/\s(?:at\s)?(\d{1,2}):(\d{2})(?:\s?(am|pm))?(?=\s)/i);
    if (m) {
      const rawH = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const suffix = m[3]?.toLowerCase();
      const h = suffix ? from12h(rawH, suffix) : rawH <= 23 ? rawH : null;
      if (h != null && mm <= 59) {
        dueTime = `${pad2(h)}:${pad2(mm)}`;
        text = text.replace(m[0], ' ');
        bareHour = !suffix && rawH >= 1 && rawH < 12;
      }
    }
  }
  if (!dueTime) {
    const m = text.match(/\s(?:at\s)?(\d{1,2})\s?(am|pm)(?=\s)/i);
    if (m) {
      const h = from12h(parseInt(m[1], 10), m[2].toLowerCase());
      if (h != null) {
        dueTime = `${pad2(h)}:00`;
        text = text.replace(m[0], ' ');
      }
    }
  }
  if (!dueTime) {
    // «At 8 in the evening» — как русское «в 8 вечера»: часть дня уточняет
    // половину суток и вырезается вместе с часом. Раньше голого «at H»,
    // иначе тот забрал бы час и оставил «in the evening» мусором в заголовке.
    const m = text.match(/\sat\s(\d{1,2})\s(?:in\sthe\s|this\s)(morning|afternoon|evening)(?=\s)/i);
    if (m) {
      let h = parseInt(m[1], 10);
      if (m[2].toLowerCase() !== 'morning' && h >= 1 && h < 12) h += 12;
      if (h <= 23) {
        dueTime = `${pad2(h)}:00`;
        text = text.replace(m[0], ' ');
      }
    }
  }
  if (!dueTime) {
    const m = text.match(/\sat\s(\d{1,2})(?=\s)/i);
    if (m) {
      const h = parseInt(m[1], 10);
      if (h <= 23) {
        dueTime = `${pad2(h)}:00`;
        text = text.replace(m[0], ' ');
        bareHour = h >= 1 && h < 12;
      }
    } else if (cut(/\sat\snoon(?=\s)/i)) {
      // Только с предлогом: голые noon/midnight — обычные существительные
      // («buy midnight snack»), как и части дня ниже.
      dueTime = '12:00';
    } else if (cut(/\sat\smidnight(?=\s)/i)) {
      dueTime = '00:00';
    }
  }

  // «In 3 days» / «in a week» — раньше остальных дат, как «через N» в русской.
  const today = () => startOfDay(new Date());
  const relM = cut(/\sin\s(?:(\d+)|an?)\s(day|days|week|weeks|month|months)(?=\s)/i);
  if (relM) {
    const n = relM[1] ? parseInt(relM[1], 10) : 1;
    const unit = relM[2].toLowerCase();
    if (unit.startsWith('d')) dueDate = toKey(addDays(today(), n));
    else if (unit.startsWith('w')) dueDate = toKey(addWeeks(today(), n));
    else dueDate = toKey(addMonths(today(), n));
  }

  // Конкретные даты: «15 June [2027]», «June 15[, 2027]» (порядковые st/nd/rd/th
  // допустимы), «15/06[/2027]». Вырезается только валидная дата — правило то же.
  // Запятая допустима перед годом («June 15, 2027») и хвостом после даты
  // («June 15, prep docs») — вырезается вместе с датой, чтобы не сиротела.
  if (!dueDate) {
    const m = text.match(
      new RegExp(`\\s(\\d{1,2})(?:st|nd|rd|th)?\\s(${MONTH_ALT})(?:,?\\s(\\d{4}))?,?(?=\\s)`, 'i'),
    );
    if (m) {
      const d = explicitDate(parseInt(m[1], 10), MONTHS_EN[m[2].toLowerCase()], m[3] ? parseInt(m[3], 10) : null);
      if (d) {
        dueDate = d;
        text = text.replace(m[0], ' ');
      }
    }
  }
  if (!dueDate) {
    const m = text.match(
      new RegExp(`\\s(${MONTH_ALT})\\s(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s(\\d{4}))?,?(?=\\s)`, 'i'),
    );
    if (m) {
      const d = explicitDate(parseInt(m[2], 10), MONTHS_EN[m[1].toLowerCase()], m[3] ? parseInt(m[3], 10) : null);
      if (d) {
        dueDate = d;
        text = text.replace(m[0], ' ');
      }
    }
  }
  if (!dueDate) {
    const m = text.match(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?(?=\s)/);
    if (m) {
      // «1/2», «3/4», «5/8» — обыкновенные дроби (полдюйма, три четверти
      // и прочие imperial-размеры), а не даты: однозначный числитель меньше
      // однозначного знаменателя 2/3/4/8 без года датой не считаем.
      // «5/9», «15/6», «05/08» — по-прежнему даты (день/месяц).
      const day = parseInt(m[1], 10);
      const mon = parseInt(m[2], 10);
      const fraction =
        !m[3] && m[1].length === 1 && m[2].length === 1 && day < mon && [2, 3, 4, 8].includes(mon);
      const d = fraction ? null : explicitDate(day, mon - 1, m[3] ? parseInt(m[3], 10) : null);
      if (d) {
        dueDate = d;
        text = text.replace(m[0], ' ');
      }
    }
  }

  // Относительные дни («day after tomorrow» — раньше «tomorrow», иначе
  // «tomorrow» съел бы середину фразы и оставил мусор в заголовке).
  if (!dueDate) {
    if (cut(/\stoday(?=\s)/i)) {
      dueDate = todayKey();
    } else if (cut(/\s(?:the\s)?day\safter\stomorrow(?=\s)/i)) {
      dueDate = toKey(addDays(today(), 2));
    } else if (cut(/\stomorrow(?=\s)/i)) {
      dueDate = toKey(addDays(today(), 1));
    } else {
      // «Next monday» — до простых дней недели (ближайший ≠ на следующей неделе).
      const nextM = cut(new RegExp(`\\s(?:on\\s)?next\\s(${WEEKDAY_ALT})(?=\\s)`, 'i'));
      if (nextM) {
        dueDate = weekdayNextWeek(WEEKDAYS_EN[nextM[1].toLowerCase()]);
      } else {
        // Сокращения — только после предлога (см. WEEKDAY_FULL_ALT выше).
        const wdM = cut(
          new RegExp(`\\s(?:(?:on|this)\\s(${WEEKDAY_ALT})|(${WEEKDAY_FULL_ALT}))(?=\\s)`, 'i'),
        );
        if (wdM) dueDate = nextWeekday(WEEKDAYS_EN[(wdM[1] ?? wdM[2]).toLowerCase()]);
      }
    }
  }

  // Части дня; «tonight» = сегодня вечером. Без даты означают «сегодня».
  if (!dueTime) {
    const partM = cut(/\s(?:in\sthe|this)\s(morning|afternoon|evening)(?=\s)/i);
    if (partM) {
      dueTime = DAY_PARTS_EN[partM[1].toLowerCase()];
      if (!dueDate) dueDate = todayKey();
    } else if (cut(/\sat\snight(?=\s)/i)) {
      dueTime = '22:00';
      if (!dueDate) dueDate = todayKey();
    }
  }
  if (cut(/\stonight(?=\s)/i)) {
    if (!dueTime) {
      dueTime = '19:00';
    } else if (bareHour) {
      // «Tonight at 9» — вечер: голый час без am/pm поднимаем во вторую
      // половину суток. Явные «9am»/«21:00» tonight не переписывает.
      dueTime = `${pad2(parseInt(dueTime.slice(0, 2), 10) + 12)}:${dueTime.slice(3)}`;
    }
    if (!dueDate) dueDate = todayKey();
  }

  if (dueTime && !dueDate) dueDate = todayKey();

  const title = text.replace(/\s+/g, ' ').trim();
  return {
    title: title || raw.trim(),
    dueDate,
    dueTime: dueDate ? dueTime : null,
    priority,
    tags,
  };
}

// Ключи словаря — русские строки, перевод в момент вызова (t в колбэке рендера,
// не в константе модуля — константы вычисляются до setLang).
const PRIORITY_HINT: Record<Priority, string> = { 0: '', 1: '!низкий', 2: '!!средний', 3: '!!!высокий' };

/** Короткая подсказка под полем быстрого ввода — что распознано. */
export function describeParsed(p: ParsedTask): string | null {
  const parts: string[] = [];
  if (p.dueDate) {
    const label = formatDueDate(p.dueDate);
    parts.push(label.charAt(0).toLowerCase() + label.slice(1));
    if (p.dueTime) parts.push(t('в {time}', { time: p.dueTime }));
  }
  if (p.priority > 0) parts.push(t(PRIORITY_HINT[p.priority]));
  for (const tag of p.tags) parts.push(`#${tag}`);
  return parts.length ? parts.join(' · ') : null;
}
