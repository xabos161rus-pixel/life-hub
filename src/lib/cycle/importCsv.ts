// Импорт истории цикла из другого приложения.
//
// ЧЕСТНО О ГРАНИЦАХ: точных схем выгрузки Flo и Clue у меня нет — я их не
// видел и подгонять разбор под выдуманные имена колонок не стал бы, потому
// что такой импорт не заработал бы ни с одним настоящим файлом. Поэтому здесь
// не «парсер Flo» и не «парсер Clue», а разбор, терпимый к формату: колонки
// определяются по смыслу из набора синонимов на двух языках, а всё, что не
// распозналось, показывается человеку до записи.
//
// Практически это покрывает больше, чем два жёстких парсера: CSV с датой и
// отметкой выделений выгружают все трекеры, и любой из них зайдёт сюда.
//
// Если появится настоящий файл — синонимы дополняются одной строкой, а
// структура не меняется.

import type { BleedingLevel, LocalDate } from '../../db/cycleTypes';

/** Колонка с датой. Порядок важен: сначала точные имена, потом общие. */
const DATE_KEYS = [
  'date', 'дата', 'day', 'день', 'period start', 'cycle day', 'дата начала',
  'дата записи', 'datum', 'fecha',
];

/** Колонка с выделениями. */
const FLOW_KEYS = [
  'flow', 'period', 'bleeding', 'menstrual flow', 'menstruation',
  'выделения', 'менструация', 'кровотечение', 'обильность', 'месячные',
];

/** Значение → уровень. Ключи в нижнем регистре, сравнение по вхождению:
 *  приложения пишут и «Light», и «light flow», и «Слабые выделения». */
const LEVEL_WORDS: [string, BleedingLevel][] = [
  ['spot', 'spotting'], ['мазн', 'spotting'], ['мажущ', 'spotting'],
  ['light', 'light'], ['слаб', 'light'], ['скуд', 'light'], ['low', 'light'],
  ['medium', 'medium'], ['moderate', 'medium'], ['normal', 'medium'],
  ['умерен', 'medium'], ['средн', 'medium'], ['обычн', 'medium'],
  ['heavy', 'heavy'], ['обильн', 'heavy'], ['сильн', 'heavy'], ['high', 'heavy'],
  ['none', 'none'], ['нет', 'none'], ['no flow', 'none'],
];

export interface ImportedDay {
  date: LocalDate;
  bleeding: BleedingLevel;
}

export interface ImportReport {
  days: ImportedDay[];
  /** Строк в файле всего (без заголовка). */
  rows: number;
  /** Строк, где не удалось прочитать дату. */
  skippedNoDate: number;
  /** Строк с датой, но без распознанной отметки выделений. */
  skippedNoFlow: number;
  /** Какие колонки использованы — показываем человеку, чтобы он мог
   *  убедиться, что разобрано именно то, что он думает. */
  dateColumn: string | null;
  flowColumn: string | null;
  from: LocalDate | null;
  to: LocalDate | null;
}

/** Разбор строки CSV с учётом кавычек: в выгрузках попадаются поля с запятыми
 *  внутри («Light, spotting»), и наивный split по запятой их разрывает. */
export function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Разделитель: запятая, точка с запятой или таб. Выбираем тот, что даёт
 *  больше всего колонок в заголовке — угадывание по одному символу ошибается
 *  на европейских выгрузках, где разделитель «;», а внутри полей запятые. */
function detectSeparator(header: string): string {
  return [',', ';', '\t']
    .map((s) => ({ s, n: parseCsvLine(header, s).length }))
    .sort((a, b) => b.n - a.n)[0].s;
}

/** Дата в 'YYYY-MM-DD' из распространённых форматов.
 *
 *  Формат вида 01/02/2026 неоднозначен: это и 1 февраля, и 2 января. Разбираем
 *  как ДЕНЬ/МЕСЯЦ (европейский порядок) — но только когда день > 12 где-то
 *  ещё в файле это подтвердил бы; здесь мы этого не знаем, поэтому такие даты
 *  считаем нераспознанными и говорим об этом честно, вместо того чтобы
 *  сдвинуть человеку половину истории на месяцы. */
export function parseDate(raw: string): LocalDate | null {
  const s = raw.trim();
  // ISO — единственный однозначный формат.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // ДД.ММ.ГГГГ — точка как разделитель однозначно европейская.
  const dot = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (dot) {
    const [, d, m, y] = dot;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // ГГГГ/ММ/ДД — тоже однозначно, год впереди.
  const ymd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(s);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/** Уровень выделений из произвольной записи. */
export function parseFlow(raw: string): BleedingLevel | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  for (const [word, level] of LEVEL_WORDS) if (s.includes(word)) return level;
  // Числовые шкалы: 0 — нет, дальше по возрастанию. Встречаются в выгрузках,
  // где обильность записана цифрой 0..3 или 1..4.
  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n <= 0) return 'none';
    if (n === 1) return 'light';
    if (n === 2) return 'medium';
    if (n >= 3) return 'heavy';
  }
  // Отметка «да» без уровня — считаем обычной менструацией: пропустить её
  // значило бы потерять сам факт дня, а это главное, что импортируют.
  if (['yes', 'true', 'да', '1', 'x', '✓'].includes(s)) return 'medium';
  return null;
}

function findColumn(header: string[], keys: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const key of keys) {
    const exact = lower.indexOf(key);
    if (exact >= 0) return exact;
  }
  for (const key of keys) {
    const partial = lower.findIndex((h) => h.includes(key));
    if (partial >= 0) return partial;
  }
  return -1;
}

/** Разобрать выгрузку. Ничего не пишет — только отчёт, который показывается
 *  человеку ДО импорта: он должен видеть, что именно распозналось. */
export function parseCycleCsv(text: string): ImportReport {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const empty: ImportReport = {
    days: [], rows: 0, skippedNoDate: 0, skippedNoFlow: 0,
    dateColumn: null, flowColumn: null, from: null, to: null,
  };
  if (lines.length < 2) return empty;

  const sep = detectSeparator(lines[0]);
  const header = parseCsvLine(lines[0], sep);
  const dateIdx = findColumn(header, DATE_KEYS);
  const flowIdx = findColumn(header, FLOW_KEYS);
  if (dateIdx < 0) return { ...empty, rows: lines.length - 1 };

  const byDate = new Map<LocalDate, BleedingLevel>();
  let skippedNoDate = 0;
  let skippedNoFlow = 0;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line, sep);
    const date = parseDate(cells[dateIdx] ?? '');
    if (!date) {
      skippedNoDate++;
      continue;
    }
    // Колонки выделений нет — берём любую ячейку, похожую на уровень: часть
    // выгрузок кладёт всё в одну колонку «что отмечено за день».
    const flow =
      flowIdx >= 0
        ? parseFlow(cells[flowIdx] ?? '')
        : cells.map(parseFlow).find((v): v is BleedingLevel => v !== null) ?? null;
    if (!flow) {
      skippedNoFlow++;
      continue;
    }
    // Повторы по дате: последняя запись побеждает — выгрузки иногда содержат
    // несколько строк на день (утро/вечер).
    byDate.set(date, flow);
  }
  const days = [...byDate.entries()]
    .map(([date, bleeding]) => ({ date, bleeding }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    days,
    rows: lines.length - 1,
    skippedNoDate,
    skippedNoFlow,
    dateColumn: header[dateIdx] ?? null,
    flowColumn: flowIdx >= 0 ? (header[flowIdx] ?? null) : null,
    from: days[0]?.date ?? null,
    to: days[days.length - 1]?.date ?? null,
  };
}
