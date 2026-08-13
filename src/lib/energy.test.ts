import { describe, expect, it } from 'vitest';
import type { EnergyLevel, EnergyLog } from '../db/types';
import {
  byWeekday,
  dailyPoints,
  hasEnoughMarks,
  levelByDate,
  splitByLevel,
  weekTrend,
  windowDates,
} from './energy';

// Конструктор минимальной отметки: тестам важны date/level/updatedAt,
// остальные поля BaseEntity — шум (как в habits.test.ts).
let seq = 0;
function log(date: string, level: EnergyLevel, updatedAt = '2026-01-01T00:00:00.000Z'): EnergyLog {
  seq += 1;
  return {
    id: `e${seq}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    deletedAt: null,
    date,
    level,
  };
}

/** Карта из пар [дата, уровень] — короче, чем городить логи в каждом тесте. */
function marks(pairs: [string, EnergyLevel][]): Map<string, EnergyLevel> {
  return new Map(pairs);
}

describe('levelByDate', () => {
  it('складывает отметки в карту по датам', () => {
    const m = levelByDate([log('2026-03-02', 4), log('2026-03-01', 2)]);
    expect(m.get('2026-03-01')).toBe(2);
    expect(m.get('2026-03-02')).toBe(4);
    expect(m.size).toBe(2);
  });

  it('при дубле на одну дату побеждает более поздняя по updatedAt, а не порядок в массиве', () => {
    const late = log('2026-03-01', 5, '2026-03-01T20:00:00.000Z');
    const early = log('2026-03-01', 1, '2026-03-01T08:00:00.000Z');
    expect(levelByDate([late, early]).get('2026-03-01')).toBe(5);
    expect(levelByDate([early, late]).get('2026-03-01')).toBe(5);
  });
});

describe('windowDates', () => {
  it('отдаёт окно от старых к свежим, последний день — сегодня', () => {
    expect(windowDates('2026-03-10', 3)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10']);
  });

  it('переходит через границу месяца', () => {
    expect(windowDates('2026-03-01', 2)).toEqual(['2026-02-28', '2026-03-01']);
  });
});

describe('weekTrend', () => {
  it('считает средние по двум окнам и разницу между ними', () => {
    const m = marks([
      // текущая неделя: 04-04 … 04-10
      ['2026-04-10', 4],
      ['2026-04-09', 4],
      // предыдущая: 03-28 … 04-03
      ['2026-04-03', 2],
      ['2026-04-02', 2],
    ]);
    const t = weekTrend(m, '2026-04-10');
    expect(t.current).toEqual({ avg: 4, n: 2 });
    expect(t.previous).toEqual({ avg: 2, n: 2 });
    expect(t.delta).toBe(2);
  });

  it('пропущенный день не считается нулём и не тянет среднюю вниз', () => {
    const t = weekTrend(marks([['2026-04-10', 5]]), '2026-04-10');
    expect(t.current).toEqual({ avg: 5, n: 1 });
  });

  it('без отметок в одном из окон разница не выдумывается', () => {
    const t = weekTrend(marks([['2026-04-10', 5]]), '2026-04-10');
    expect(t.previous).toEqual({ avg: null, n: 0 });
    expect(t.delta).toBeNull();
  });

  it('окна стыкуются без нахлёста: каждый день считается ровно один раз', () => {
    // Границы относительно today=2026-04-10: 04-04 — первый день текущего окна,
    // 04-03 — последний день предыдущего, 03-28 — первый день предыдущего.
    const first = weekTrend(marks([['2026-04-04', 1]]), '2026-04-10');
    expect(first.current.n).toBe(1);
    expect(first.previous.n).toBe(0); // иначе день учтён дважды

    const last = weekTrend(marks([['2026-04-03', 1]]), '2026-04-10');
    expect(last.current.n).toBe(0);
    expect(last.previous.n).toBe(1);

    const oldest = weekTrend(marks([['2026-03-28', 1]]), '2026-04-10');
    expect(oldest.previous.n).toBe(1);

    // За краем обоих окон — не считается вовсе.
    const outside = weekTrend(marks([['2026-03-27', 1]]), '2026-04-10');
    expect(outside.current.n).toBe(0);
    expect(outside.previous.n).toBe(0);
  });
});

describe('dailyPoints', () => {
  it('отдаёт день за днём, пропуски — null, а не ноль', () => {
    const pts = dailyPoints(marks([['2026-04-10', 3]]), '2026-04-10', 3);
    expect(pts).toEqual([
      { date: '2026-04-08', level: null },
      { date: '2026-04-09', level: null },
      { date: '2026-04-10', level: 3 },
    ]);
  });

  it('по умолчанию окно в 28 дней', () => {
    expect(dailyPoints(new Map(), '2026-04-10')).toHaveLength(28);
  });
});

describe('byWeekday', () => {
  it('усредняет по дню недели: два понедельника дают среднее из двух отметок', () => {
    // 2026-04-06 и 2026-04-13 — понедельники, 2026-04-11 — суббота.
    const m = marks([
      ['2026-04-06', 2],
      ['2026-04-13', 4],
      ['2026-04-11', 5],
    ]);
    const rows = byWeekday(m, '2026-04-13', 14);
    expect(rows.find((r) => r.weekday === 1)).toEqual({ weekday: 1, avg: 3, n: 2 });
    expect(rows.find((r) => r.weekday === 6)).toEqual({ weekday: 6, avg: 5, n: 1 });
  });

  it('день недели без отметок отдаёт null, а не ноль', () => {
    const rows = byWeekday(marks([['2026-04-13', 4]]), '2026-04-13', 7);
    expect(rows.find((r) => r.weekday === 2)).toEqual({ weekday: 2, avg: null, n: 0 });
  });

  it('всегда семь строк, по одной на день недели', () => {
    expect(byWeekday(new Map(), '2026-04-13')).toHaveLength(7);
  });
});

describe('splitByLevel', () => {
  it('делит метрику на полюса энергии и усредняет каждую группу', () => {
    const m = marks([
      ['2026-05-01', 1],
      ['2026-05-02', 2],
      ['2026-05-03', 5],
      ['2026-05-04', 4],
    ]);
    const samples = new Map([
      ['2026-05-01', 0.2],
      ['2026-05-02', 0.4],
      ['2026-05-03', 1],
      ['2026-05-04', 0.8],
    ]);
    const s = splitByLevel(m, samples);
    expect(s.low).toEqual({ avg: 0.30000000000000004, n: 2 });
    expect(s.high).toEqual({ avg: 0.9, n: 2 });
  });

  it('средние дни (3) не попадают ни в одну группу', () => {
    const s = splitByLevel(marks([['2026-05-01', 3]]), new Map([['2026-05-01', 1]]));
    expect(s.low.n).toBe(0);
    expect(s.high.n).toBe(0);
  });

  it('день метрики без отметки энергии в связку не идёт', () => {
    const s = splitByLevel(marks([['2026-05-01', 1]]), new Map([['2026-05-09', 1]]));
    expect(s.low).toEqual({ avg: null, n: 0 });
  });
});

describe('hasEnoughMarks', () => {
  it('шесть отметок — мало, семь — достаточно', () => {
    const six = marks(
      ['01', '02', '03', '04', '05', '06'].map((d) => [`2026-06-${d}`, 3] as [string, EnergyLevel]),
    );
    expect(hasEnoughMarks(six)).toBe(false);
    six.set('2026-06-07', 3);
    expect(hasEnoughMarks(six)).toBe(true);
  });
});
