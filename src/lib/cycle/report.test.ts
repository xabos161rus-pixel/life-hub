import { describe, expect, it } from 'vitest';
import { buildDoctorReport } from './report';
import type {
  Cycle,
  CycleDayLog,
  CycleEpisode,
  LocalDate,
  SymptomDef,
} from '../../db/cycleTypes';
import { MENSTRUAL_LEVELS } from '../../db/cycleTypes';
import { addDaysKey } from '../dates';

const NOW = '2026-07-25T10:00:00.000Z';
const TODAY = '2026-07-25';

function chain(start: LocalDate, lengths: number[], periodLen = 5): Cycle[] {
  const out: Cycle[] = [];
  let cursor = start;
  for (const len of lengths) {
    out.push({
      startDate: cursor,
      endDate: addDaysKey(cursor, len - 1),
      lengthDays: len,
      periodEndDate: addDaysKey(cursor, periodLen - 1),
      periodLengthDays: periodLen,
      status: 'complete',
      excluded: 0,
      hasDataGaps: 0,
      startConfirmed: 0,
      derivedAt: NOW,
    });
    cursor = addDaysKey(cursor, len);
  }
  return out;
}

function day(date: LocalDate, extra: Partial<CycleDayLog> = {}): CycleDayLog {
  return {
    date,
    isBleedingDay: extra.bleeding && MENSTRUAL_LEVELS.includes(extra.bleeding) ? 1 : 0,
    createdAt: NOW,
    updatedAt: NOW,
    source: 'user',
    ...extra,
  };
}

const symptomDefs: SymptomDef[] = [
  {
    key: 'cramps',
    group: 'somatic',
    scale: 'severity',
    label: 'Спазмы внизу живота',
    builtIn: true,
    enabled: true,
    order: 10,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    key: 'headache',
    group: 'somatic',
    scale: 'severity',
    label: 'Головная боль',
    builtIn: true,
    enabled: true,
    order: 20,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

describe('buildDoctorReport — окна', () => {
  it('6months отсчитывает от сегодня ровно шесть календарных месяцев', () => {
    const r = buildDoctorReport({
      days: [],
      cycles: [],
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.periodFrom).toBe('2026-01-25');
    expect(r.periodTo).toBe(TODAY);
  });

  it('12months отсчитывает от сегодня ровно двенадцать календарных месяцев', () => {
    const r = buildDoctorReport({
      days: [],
      cycles: [],
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: '12months',
      today: TODAY,
    });
    expect(r.periodFrom).toBe('2025-07-25');
  });

  it('last2cycles берёт два последних завершённых плюс текущий незавершённый', () => {
    // Три завершённых цикла + текущий, начавшийся позже всех.
    const cycles = chain('2026-01-01', [28, 30, 27]);
    cycles.push({
      startDate: '2026-06-30',
      status: 'current',
      excluded: 0,
      hasDataGaps: 0,
      startConfirmed: 0,
      derivedAt: NOW,
    });
    const r = buildDoctorReport({
      days: [],
      cycles,
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: 'last2cycles',
      today: TODAY,
    });
    // Период начинается с более раннего из последних ДВУХ завершённых
    // (второй и третий циклы в цепочке), первый в выборку не попадает.
    expect(r.periodFrom).toBe(cycles[1].startDate);
    expect(r.cycles.map((c) => c.startDate).sort()).toEqual(
      [cycles[1].startDate, cycles[2].startDate, cycles[3].startDate].sort(),
    );
    // Текущий незавершённый — без длины.
    const current = r.cycles.find((c) => c.startDate === '2026-06-30')!;
    expect(current.lengthDays).toBeUndefined();
  });

  it('last2cycles без единого цикла даёт пустой период на сегодня', () => {
    const r = buildDoctorReport({
      days: [],
      cycles: [],
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: 'last2cycles',
      today: TODAY,
    });
    expect(r.periodFrom).toBe(TODAY);
    expect(r.periodTo).toBe(TODAY);
    expect(r.cycles).toEqual([]);
  });
});

describe('buildDoctorReport — циклы и исключения', () => {
  it('помечает исключённый цикл русской причиной по словарю', () => {
    const cycles = chain('2026-02-01', [28]);
    cycles[0].excluded = 1;
    cycles[0].excludeReason = 'pregnancy';
    const r = buildDoctorReport({
      days: [],
      cycles,
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.cycles[0].excluded).toBe(true);
    expect(r.cycles[0].excludeReasonLabel).toBe('беременность');
  });

  it('статистика периода считается готовым cycleStats, без своей математики', () => {
    const cycles = chain('2026-02-01', [28, 30, 26]);
    const r = buildDoctorReport({
      days: [],
      cycles,
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.stats.n).toBe(3);
    expect(r.stats.shortestLength).toBe(26);
    expect(r.stats.longestLength).toBe(30);
    expect(r.stats.spread).toBe(4);
  });
});

describe('buildDoctorReport — симптомы и кровотечение', () => {
  it('считает дни симптома и подставляет русское название', () => {
    const cycles = chain('2026-02-01', [28]);
    const days = [
      day('2026-02-01', { symptomKeys: ['cramps'] }),
      day('2026-02-02', { symptomKeys: ['cramps', 'headache'] }),
      day('2026-02-03', { symptomKeys: ['headache'] }),
    ];
    const r = buildDoctorReport({
      days,
      cycles,
      episodes: [],
      symptoms: symptomDefs,
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    // Оба симптома встретились по 2 раза — равенство по счёту разрешается
    // алфавитным порядком названий (детерминированно и понятно на печати).
    expect(r.symptomFrequency).toEqual([
      { key: 'headache', label: 'Головная боль', days: 2 },
      { key: 'cramps', label: 'Спазмы внизу живота', days: 2 },
    ]);
  });

  it('не включает симптомы, которых в периоде не было', () => {
    const cycles = chain('2026-02-01', [28]);
    const days = [day('2026-02-01', { symptomKeys: ['cramps'] })];
    const r = buildDoctorReport({
      days,
      cycles,
      episodes: [],
      symptoms: symptomDefs,
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.symptomFrequency.map((s) => s.key)).toEqual(['cramps']);
  });

  it('считает дни кровотечения по уровням', () => {
    const cycles = chain('2026-02-01', [28]);
    const days = [
      day('2026-02-01', { bleeding: 'heavy' }),
      day('2026-02-02', { bleeding: 'heavy' }),
      day('2026-02-03', { bleeding: 'medium' }),
      day('2026-02-04', { bleeding: 'light' }),
      day('2026-02-20', { bleeding: 'spotting' }),
    ];
    const r = buildDoctorReport({
      days,
      cycles,
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.bleedingDays).toEqual([
      { level: 'spotting', label: 'Мазня', days: 1 },
      { level: 'light', label: 'Слабое', days: 1 },
      { level: 'medium', label: 'Умеренное', days: 1 },
      { level: 'heavy', label: 'Сильное', days: 2 },
    ]);
  });
});

describe('buildDoctorReport — эпизоды и наблюдения', () => {
  it('включает эпизод, пересекающий период, с русским названием', () => {
    const episodes: CycleEpisode[] = [
      {
        id: 'ep1',
        kind: 'pregnancy',
        startDate: '2026-01-01',
        endDate: '2026-03-01',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const r = buildDoctorReport({
      days: [],
      cycles: [],
      episodes,
      symptoms: [],
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.episodes).toEqual([
      { kind: 'pregnancy', label: 'Беременность', startDate: '2026-01-01', endDate: '2026-03-01' },
    ]);
  });

  it('не включает эпизод, полностью до начала периода', () => {
    const episodes: CycleEpisode[] = [
      {
        id: 'ep1',
        kind: 'pregnancy',
        startDate: '2020-01-01',
        endDate: '2020-03-01',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const r = buildDoctorReport({
      days: [],
      cycles: [],
      episodes,
      symptoms: [],
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.episodes).toEqual([]);
  });

  it('передаёт наблюдения как есть, не пересчитывая их', () => {
    const anomalies = [
      { kind: 'irregular' as const, title: 'Циклы заметно разной длины', detail: 'детали', worthAsking: true },
    ];
    const r = buildDoctorReport({
      days: [],
      cycles: [],
      episodes: [],
      symptoms: [],
      anomalies,
      window: '6months',
      today: TODAY,
    });
    expect(r.anomalies).toBe(anomalies);
  });
});

describe('buildDoctorReport — пустой период', () => {
  it('ничего не выдумывает без единой отметки', () => {
    const r = buildDoctorReport({
      days: [],
      cycles: [],
      episodes: [],
      symptoms: [],
      anomalies: [],
      window: '6months',
      today: TODAY,
    });
    expect(r.cycles).toEqual([]);
    expect(r.stats.n).toBe(0);
    expect(r.symptomFrequency).toEqual([]);
    expect(r.bleedingDays.every((b) => b.days === 0)).toBe(true);
    expect(r.episodes).toEqual([]);
    expect(r.generatedAt).toBe(TODAY);
  });
});
