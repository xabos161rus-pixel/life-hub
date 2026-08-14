// Годовой обзор цикла: 12 месяцев одним экраном.
//
// Обоснование, почему это отдельный экран, а не просто более длинный
// календарь: у нерегулярных циклов усреднённый прогноз (карточка «сейчас»,
// CycleCalendar) обязательно врёт кому-то — сам факт усреднения стирает
// разброс. 12 месяцев ретроспективы этот разброс, наоборот, показывают:
// человек видит не «в среднем 29 дней», а как скачут её собственные циклы.
// Подтверждённый запрос — issue #786 у drip, куда люди с нерегулярным циклом
// годами просят именно годовую сетку вместо месячной.
//
// Здесь только сборка структуры «месяцы → клетки» из уже посчитанных days и
// cycles: React, Dexie и форматирование чисел в интерфейсе сюда не входят
// сознательно — это чистая функция, которую проще проверить тестами, чем
// компонент.

import type { BleedingLevel, Cycle, LocalDate } from '../../db/cycleTypes';
import { formatRu } from '../dates';
import { getLang, t } from '../i18n';

/** Источник дневных данных, нужный этому модулю — не весь CycleDayLog:
 *  структурная типизация всё равно принимает полный объект из useCycleData,
 *  а тесты избавлены от необходимости собирать лишние обязательные поля. */
export interface YearDaySource {
  bleeding?: BleedingLevel;
}

/** 'none' — это явное «кровотечения не было», а не что показывать в клетке:
 *  клетка без данных и клетка с явным «не было» выглядят одинаково пусто. */
export type YearBleedingLevel = Exclude<BleedingLevel, 'none'>;

export interface YearDayCell {
  /** Номер колонки, 1..31 — то же число для всех месяцев, чтобы дни разных
   *  месяцев стояли в сетке друг под другом. */
  day: number;
  /** undefined, если в этом месяце такого числа нет (30 февраля и т.п.):
   *  колонка остаётся, но пустой — иначе короткие месяцы съезжали бы влево
   *  относительно длинных, и «14-е» перестало бы быть одной вертикалью. */
  date?: LocalDate;
  /** День позже today: показывать в нём нечего, а не «не было данных». */
  future: boolean;
  bleeding?: YearBleedingLevel;
  isCycleStart: boolean;
  /** Только у клеток со значимым содержимым (bleeding или начало цикла).
   *  Пустые клетки прошлого не должны каждая объявляться скринридером —
   *  их 350+ на экране, и это был бы чистый шум без единого факта внутри. */
  ariaLabel?: string;
}

export interface YearMonthRow {
  /** 'YYYY-MM'. */
  key: string;
  /** «Июль 2026». */
  label: string;
  /** Ровно 31 клетка — включая несуществующие числа коротких месяцев. */
  days: YearDayCell[];
}

export interface YearCycleSummary {
  startDate: LocalDate;
  lengthDays: number;
  periodLengthDays?: number;
  excluded: boolean;
}

export interface YearOverview {
  /** 12 месяцев, от текущего к самому старому — тот же порядок, в котором
   *  их видно на экране сверху вниз. */
  months: YearMonthRow[];
  /** Завершённые циклы, начавшиеся в эти 12 месяцев, в том же порядке. */
  cycles: YearCycleSummary[];
}

const MONTH_ROWS = 12;
const CELL_COLUMNS = 31;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Число дней в месяце. month1 — 1..12. День 0 следующего месяца в UTC —
 *  ровно последний день текущего: тот же приём, что и в CycleCalendar. */
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function monthLabel(year: number, month1: number): string {
  const d = new Date(Date.UTC(year, month1 - 1, 1));
  const locale = getLang() === 'en' ? 'en-US' : 'ru-RU';
  const name = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(d);
  return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + year;
}

const BLEEDING_LABEL: Record<YearBleedingLevel, string> = {
  spotting: 'мажущие выделения',
  light: 'менструация, слабо',
  medium: 'менструация, умеренно',
  heavy: 'менструация, обильно',
};

function describeDay(
  date: LocalDate,
  bleeding: YearBleedingLevel | undefined,
  isCycleStart: boolean,
): string {
  return [date && formatRu(date), bleeding ? t(BLEEDING_LABEL[bleeding]) : null, isCycleStart ? t('начало цикла') : null]
    .filter(Boolean)
    .join(', ');
}

/** 'YYYY-MM' за последние `count` месяцев, от того, что содержит `today`,
 *  назад. Отдельная функция ради теста границы года (январь → декабрь
 *  предыдущего). */
export function lastMonthKeys(today: LocalDate, count = MONTH_ROWS): string[] {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const total = y * 12 + (m - 1) - i;
    const yy = Math.floor(total / 12);
    const mm = (total % 12) + 1;
    out.push(`${yy}-${pad2(mm)}`);
  }
  return out;
}

/** Собирает 12 месяцев клеток и список завершённых циклов периода.
 *
 *  `dayByDate` и `cycles` — то, что уже лежит в useCycleData: повторного
 *  похода в Dexie отсюда нет и не должно быть, экран строится над тем, что
 *  посчитано один раз для всего раздела. */
export function buildYearOverview(
  dayByDate: Map<LocalDate, YearDaySource>,
  cycles: Cycle[],
  today: LocalDate,
): YearOverview {
  const monthKeys = lastMonthKeys(today);
  // Начало цикла помечаем по ВСЕМ циклам, включая текущий незавершённый и
  // исключённые: это факт из данных, а не статистика, у которой есть повод
  // что-то отфильтровать.
  const cycleStarts = new Set(cycles.map((c) => c.startDate));

  const months: YearMonthRow[] = monthKeys.map((key) => {
    const [y, m] = key.split('-').map(Number);
    const total = daysInMonth(y, m);
    const days: YearDayCell[] = [];

    for (let day = 1; day <= CELL_COLUMNS; day++) {
      if (day > total) {
        days.push({ day, future: false, isCycleStart: false });
        continue;
      }
      const date = `${key}-${pad2(day)}`;
      const future = date > today;
      // Данные будущего дня не читаем даже если они как-то оказались в базе:
      // будущий день обязан выглядеть пустым независимо от содержимого.
      const log = future ? undefined : dayByDate.get(date);
      const raw = log?.bleeding;
      const bleeding = raw && raw !== 'none' ? raw : undefined;
      const isCycleStart = !future && cycleStarts.has(date);
      const significant = bleeding !== undefined || isCycleStart;

      days.push({
        day,
        date,
        future,
        bleeding,
        isCycleStart,
        ariaLabel: significant ? describeDay(date, bleeding, isCycleStart) : undefined,
      });
    }

    return { key, label: monthLabel(y, m), days };
  });

  // Граница периода — первое число самого старого месяца из отрисованных:
  // список циклов обязан описывать ровно то, что видно в сетке выше, а не
  // отдельно выбранное окно.
  const periodStart = `${monthKeys[monthKeys.length - 1]}-01`;
  const cyclesInPeriod: YearCycleSummary[] = cycles
    // «Завершённый» здесь значит именно это: lengthDays появляется только у
    // цикла с известным концом (см. Cycle.lengthDays в cycleTypes.ts) —
    // текущий незавершённый цикл в список чисел не попадает никогда.
    .filter((c) => c.lengthDays !== undefined && c.startDate >= periodStart)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    .map((c) => ({
      startDate: c.startDate,
      lengthDays: c.lengthDays!,
      periodLengthDays: c.periodLengthDays,
      excluded: c.excluded === 1,
    }));

  return { months, cycles: cyclesInPeriod };
}
