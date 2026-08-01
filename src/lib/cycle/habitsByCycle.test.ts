import { describe, expect, it } from 'vitest';
import type { Cycle } from '../../db/cycleTypes';
import type { Habit, HabitLog } from '../../db/types';
import { buildHabitsByCycle } from './habitsByCycle';

// Конструкторы минимальных сущностей: тестам важны расписание, цель и даты,
// остальные поля BaseEntity — шум, который заполняем один раз здесь.

let seq = 0;

function habit(over: Partial<Habit> = {}): Habit {
  seq += 1;
  return {
    id: `h${seq}`,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    deletedAt: null,
    name: 'Привычка',
    emoji: '✅',
    color: '#000',
    schedule: { type: 'daily' },
    target: null,
    unit: '',
    goalId: null,
    archivedAt: null,
    sortOrder: 0,
    ...over,
  };
}

function log(habitId: string, date: string, value: number | null = null): HabitLog {
  seq += 1;
  return {
    id: `l${seq}`,
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
    deletedAt: null,
    habitId,
    date,
    value,
  };
}

/** Завершённый цикл: 28 дней, менструация 5 дней, если не сказано иное. */
function cycle(startDate: string, over: Partial<Cycle> = {}): Cycle {
  const base: Cycle = {
    startDate,
    endDate: addDays(startDate, 27),
    lengthDays: 28,
    periodEndDate: addDays(startDate, 4),
    periodLengthDays: 5,
    status: 'complete',
    excluded: 0,
    hasDataGaps: 0,
    startConfirmed: 1,
    derivedAt: '2026-01-01T00:00:00.000Z',
  };
  return { ...base, ...over };
}

function addDays(key: string, days: number): string {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Все даты цикла [start, start+27]. */
function allDates(startDate: string): string[] {
  return Array.from({ length: 28 }, (_, i) => addDays(startDate, i));
}

describe('buildHabitsByCycle', () => {
  const twoCycles = [cycle('2026-03-01'), cycle('2026-03-29')];

  it('нет привычек или меньше двух завершённых циклов — undefined', () => {
    expect(buildHabitsByCycle([], [], twoCycles)).toBeUndefined();
    expect(buildHabitsByCycle([habit()], [], [cycle('2026-03-01')])).toBeUndefined();
  });

  it('текущий и исключённый циклы не участвуют', () => {
    const cycles = [
      cycle('2026-03-01'),
      cycle('2026-03-29', { excluded: 1 }),
      cycle('2026-04-26', { endDate: undefined, lengthDays: undefined, status: 'current' }),
    ];
    // Остался один пригодный цикл — меньше минимума.
    expect(buildHabitsByCycle([habit()], [], cycles)).toBeUndefined();
  });

  it('раскладывает дни по окнам и считает доли', () => {
    const h = habit();
    // Выполнено всё, кроме дней менструации: там ни одного лога.
    const logs = twoCycles.flatMap((c) =>
      allDates(c.startDate)
        .filter((d) => d > c.periodEndDate!)
        .map((d) => log(h.id, d)),
    );
    const result = buildHabitsByCycle([h], logs, twoCycles)!;
    expect(result.cyclesUsed).toBe(2);

    const period = result.rows.find((r) => r.window === 'period')!;
    const pre = result.rows.find((r) => r.window === 'preMenstrual')!;
    const other = result.rows.find((r) => r.window === 'other')!;
    // 5 дней менструации × 2 цикла, 5 предменструальных × 2, остальное — 18 × 2.
    expect(period.planned).toBe(10);
    expect(period.done).toBe(0);
    expect(period.share).toBe(0);
    expect(pre.planned).toBe(10);
    expect(pre.done).toBe(10);
    expect(pre.share).toBe(1);
    expect(other.planned).toBe(36);
    expect(other.done).toBe(36);
  });

  it('окно, не добравшее порога наблюдений, не показывается', () => {
    // Привычка только по понедельникам: в каждом окне запланированных дней
    // мало. 2026-03-01 — воскресенье, менструация 01–05 марта содержит один
    // понедельник (2 марта) — окно period наберёт всего 2 планових дня за два
    // цикла и обязано выпасть.
    const h = habit({ schedule: { type: 'weekdays', weekdays: [1] } });
    const logs = twoCycles.flatMap((c) => allDates(c.startDate).map((d) => log(h.id, d)));
    expect(buildHabitsByCycle([h], logs, twoCycles)).toBeUndefined();
  });

  it('замороженный период не даёт planned-дней: окно выпадает как честно пустое', () => {
    // Заморожены ровно дни менструации обоих циклов — как непланируемые дни,
    // они не попадают в «запланировано», окно period проваливается под порог
    // и не показывается, а соседние окна (не заморожены) считаются как обычно.
    const h = habit({
      frozenRanges: [
        { from: '2026-03-01', to: '2026-03-05', origin: 'manual' },
        { from: '2026-03-29', to: '2026-04-02', origin: 'manual' },
      ],
    });
    const result = buildHabitsByCycle([h], [], twoCycles)!;
    expect(result.rows.find((r) => r.window === 'period')).toBeUndefined();
    expect(result.rows.find((r) => r.window === 'preMenstrual')!.planned).toBe(10);
    expect(result.rows.find((r) => r.window === 'other')!.planned).toBe(36);
  });

  it('привычка не отвечает за дни до своего создания', () => {
    // Создана после менструации первого цикла: та не должна дать ей плана, и
    // окно менструации (5 дней второго цикла — меньше порога) выпадает.
    const h = habit({ createdAt: '2026-03-06T08:00:00.000Z' });
    const result = buildHabitsByCycle([h], [], twoCycles)!;
    expect(result.rows.find((r) => r.window === 'period')).toBeUndefined();
    expect(result.rows.find((r) => r.window === 'preMenstrual')!.planned).toBe(10);
    expect(result.rows.find((r) => r.window === 'other')!.planned).toBe(36);
  });

  it('количественная привычка выполнена только при добранной цели', () => {
    const h = habit({ target: 10, unit: 'раз' });
    const logs = twoCycles.flatMap((c) =>
      allDates(c.startDate).map((d, i) => log(h.id, d, i % 2 === 0 ? 10 : 3)),
    );
    const result = buildHabitsByCycle([h], logs, twoCycles)!;
    const other = result.rows.find((r) => r.window === 'other')!;
    // В «остальных» днях (индексы 5..22 внутри цикла) чётных индексов 9 из 18.
    expect(other.planned).toBe(36);
    expect(other.done).toBe(18);
    expect(other.share).toBe(0.5);
  });

  it('менструация сильнее пред-окна при коротком цикле', () => {
    // Циклы по 8 дней: менструация 5 дней, последние 5 дней пересекаются с
    // ней. Четыре цикла, чтобы пред-окно (3 дня с цикла) добрало порог.
    const short = ['2026-03-01', '2026-03-09', '2026-03-17', '2026-03-25'].map((s) =>
      cycle(s, { endDate: addDays(s, 7), lengthDays: 8 }),
    );
    const h = habit();
    const result = buildHabitsByCycle([h], [], short)!;
    const period = result.rows.find((r) => r.window === 'period')!;
    const pre = result.rows.find((r) => r.window === 'preMenstrual')!;
    // Дни 1–5 каждого цикла — менструация, дни 6–8 — пред-окно (пересечение
    // ушло менструации), окна «остальное» нет вовсе.
    expect(period.planned).toBe(20);
    expect(pre.planned).toBe(12);
    expect(result.rows.find((r) => r.window === 'other')).toBeUndefined();
  });
});
