// «Отчёт для врача» — сводка по циклам за выбранный период, чтобы показать или
// распечатать на приёме. Здесь только сбор и агрегация данных, чистая функция
// без Dexie и без window.print(): рендер и печать — забота экрана
// (CycleReportPage.tsx), а не этого модуля.
//
// Обоснование окон и дисклеймера — docs/cycle-tracking-research.md, M9: окна
// в источниках разные (2 цикла / 6 месяцев / 12 месяцев), поэтому даём выбор
// вместо того, чтобы угадывать один вариант.

import type {
  Cycle,
  CycleDayLog,
  CycleEpisode,
  CycleExcludeReason,
  EpisodeKind,
  LocalDate,
  SymptomDef,
} from '../../db/cycleTypes';
import { addMonths } from 'date-fns';
import { fromKey, toKey } from '../dates';
import type { Anomaly } from './anomalies';
import { cycleStats, type CycleStats } from './stats';

export type DoctorReportWindow = 'last2cycles' | '6months' | '12months';

/** Русские названия причин исключения цикла из статистики.
 *
 *  Список причин закрытый (CycleExcludeReason) — Record без индекс-сигнатуры
 *  заставит TypeScript напомнить дописать перевод, если причина появится. */
const EXCLUDE_REASON_LABELS: Record<CycleExcludeReason, string> = {
  user: 'исключён вручную',
  pregnancy: 'беременность',
  loss: 'потеря беременности',
  emergency_contraception: 'экстренная контрацепция',
  hormonal_method: 'гормональный метод контрацепции',
  illness: 'болезнь',
  data_gaps: 'пропуски в данных',
  imported_uncertain: 'перенесено из другого приложения, дата неточна',
};

/** Русские названия видов эпизода (беременность и т.п.). */
const EPISODE_KIND_LABELS: Record<EpisodeKind, string> = {
  pregnancy: 'Беременность',
  postpartum: 'Послеродовой период',
  lactational_amenorrhea: 'Лактационная аменорея',
  hormonal_suppression: 'Гормональное подавление цикла',
  loss: 'Потеря беременности',
  other_medical: 'Другая медицинская причина',
};

/** Уровни кровотечения, которые входят в отчёт, в порядке возрастания. 'none'
 *  сюда не входит намеренно — «кровотечения не было» врачу считать незачем. */
const BLEEDING_LEVELS_FOR_REPORT = ['spotting', 'light', 'medium', 'heavy'] as const;
const BLEEDING_LEVEL_LABELS: Record<(typeof BLEEDING_LEVELS_FOR_REPORT)[number], string> = {
  spotting: 'Мазня',
  light: 'Слабое',
  medium: 'Умеренное',
  heavy: 'Сильное',
};

export interface DoctorReportCycleRow {
  startDate: LocalDate;
  /** undefined — цикл ещё не завершён (текущий). */
  lengthDays?: number;
  periodLengthDays?: number;
  excluded: boolean;
  /** Только когда excluded — русская причина по словарю выше. */
  excludeReasonLabel?: string;
}

export interface DoctorReportSymptomRow {
  key: string;
  label: string;
  days: number;
}

export interface DoctorReportBleedingRow {
  level: (typeof BLEEDING_LEVELS_FOR_REPORT)[number];
  label: string;
  days: number;
}

export interface DoctorReportEpisodeRow {
  kind: EpisodeKind;
  label: string;
  startDate: LocalDate;
  endDate?: LocalDate;
}

export interface DoctorReport {
  generatedAt: LocalDate;
  window: DoctorReportWindow;
  periodFrom: LocalDate;
  periodTo: LocalDate;
  cycles: DoctorReportCycleRow[];
  stats: CycleStats;
  symptomFrequency: DoctorReportSymptomRow[];
  bleedingDays: DoctorReportBleedingRow[];
  episodes: DoctorReportEpisodeRow[];
  anomalies: Anomaly[];
}

export interface DoctorReportInput {
  days: CycleDayLog[];
  cycles: Cycle[];
  episodes: CycleEpisode[];
  symptoms: SymptomDef[];
  anomalies: Anomaly[];
  window: DoctorReportWindow;
  today: LocalDate;
}

/** Начало периода по выбранному окну. 'to' всегда 'today' — отчёт составляется
 *  на сегодня, будущих данных не бывает.
 *
 *  Для last2cycles берём дату начала более раннего из двух последних
 *  ЗАВЕРШЁННЫХ циклов (лежит в основе окна, дальше список подхватит и текущий
 *  незавершённый — его startDate позже, он не выпадет). Если завершённых
 *  циклов меньше двух, но есть текущий — окно начинается с него; если нет
 *  вообще ни одного цикла — период пуст (from = to = today). */
function periodFrom(window: DoctorReportWindow, cycles: Cycle[], today: LocalDate): LocalDate {
  if (window === '6months') return toKey(addMonths(fromKey(today), -6));
  if (window === '12months') return toKey(addMonths(fromKey(today), -12));

  const sorted = [...cycles].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const completed = sorted.filter((c) => c.status !== 'current');
  const lastTwo = completed.slice(-2);
  if (lastTwo.length > 0) return lastTwo[0].startDate;

  const current = sorted.find((c) => c.status === 'current');
  return current ? current.startDate : today;
}

export function buildDoctorReport(input: DoctorReportInput): DoctorReport {
  const { days, cycles, episodes, symptoms, anomalies, window, today } = input;

  const from = periodFrom(window, cycles, today);
  const to = today;

  // Циклы периода — те, что НАЧАЛИСЬ в окне. Тот же принцип, что в
  // detectAnomalies (lib/cycle/anomalies.ts): окно считается по датам начала,
  // а не по пересечению отрезков, — иначе цикл, стартовавший на день раньше
  // окна, то входил бы в отчёт, то нет, в зависимости от того, где именно
  // внутри окна легли его дни.
  const cyclesInPeriod = cycles
    .filter((c) => c.startDate >= from && c.startDate <= to)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)); // новые сверху — так их проще найти на приёме

  const cycleRows: DoctorReportCycleRow[] = cyclesInPeriod.map((c) => ({
    startDate: c.startDate,
    lengthDays: c.lengthDays,
    periodLengthDays: c.periodLengthDays,
    excluded: c.excluded === 1,
    excludeReasonLabel:
      c.excluded === 1 && c.excludeReason !== undefined
        ? EXCLUDE_REASON_LABELS[c.excludeReason]
        : undefined,
  }));

  // Статистика — без своей математики, готовым cycleStats. Лимит равен числу
  // циклов периода (минимум 1: cycleStats(...,0) отдал бы пустой срез).
  const stats = cycleStats(cyclesInPeriod, Math.max(cyclesInPeriod.length, 1));

  const daysInPeriod = days.filter((d) => d.date >= from && d.date <= to);

  // Частота симптомов: считаем дни по symptomKeys (денормализованный список —
  // он и заведён ради таких подсчётов без похода в symptoms[]), берём только
  // то, что реально встретилось в периоде, сортируем по убыванию.
  const symptomCounts = new Map<string, number>();
  for (const d of daysInPeriod) {
    for (const key of d.symptomKeys ?? []) {
      symptomCounts.set(key, (symptomCounts.get(key) ?? 0) + 1);
    }
  }
  const symptomLabel = (key: string): string =>
    symptoms.find((s) => s.key === key)?.label ?? key;
  const symptomFrequency: DoctorReportSymptomRow[] = [...symptomCounts.entries()]
    .map(([key, count]) => ({ key, label: symptomLabel(key), days: count }))
    .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label, 'ru'));

  const bleedingDays: DoctorReportBleedingRow[] = BLEEDING_LEVELS_FOR_REPORT.map((level) => ({
    level,
    label: BLEEDING_LEVEL_LABELS[level],
    days: daysInPeriod.filter((d) => d.bleeding === level).length,
  }));

  // Эпизоды периода — по пересечению отрезков (не по началу, как циклы): сама
  // беременность может начаться до периода и продолжаться внутри него, и
  // именно это врачу важно увидеть. endDate === undefined — эпизод ещё идёт.
  const episodeRows: DoctorReportEpisodeRow[] = episodes
    .filter((e) => e.startDate <= to && (e.endDate === undefined || e.endDate >= from))
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
    .map((e) => ({
      kind: e.kind,
      label: EPISODE_KIND_LABELS[e.kind],
      startDate: e.startDate,
      endDate: e.endDate,
    }));

  return {
    generatedAt: today,
    window,
    periodFrom: from,
    periodTo: to,
    cycles: cycleRows,
    stats,
    symptomFrequency,
    bleedingDays,
    episodes: episodeRows,
    // Наблюдения передаются как есть: они уже посчитаны детектором отклонений
    // (detectAnomalies) на своём собственном шестимесячном окне — пересчитывать
    // их под окно отчёта значило бы завести два разных смысла у одного текста.
    anomalies,
  };
}
