import { describe, expect, it } from 'vitest';
import type { Habit } from '../db/types';
import { habitStats, isFrozenOn } from './habits';

// Конструктор минимальной привычки: тестам важны schedule и frozenRanges,
// остальные поля BaseEntity — шум, заполняем один раз здесь (как в
// src/lib/cycle/habitsByCycle.test.ts).
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

describe('isFrozenOn', () => {
  it('границы закрытого интервала: день from и день to внутри, соседние дни снаружи', () => {
    const h = habit({ frozenRanges: [{ from: '2026-01-10', to: '2026-01-15', origin: 'manual' }] });
    expect(isFrozenOn(h, '2026-01-09')).toBe(false);
    expect(isFrozenOn(h, '2026-01-10')).toBe(true);
    expect(isFrozenOn(h, '2026-01-15')).toBe(true);
    expect(isFrozenOn(h, '2026-01-16')).toBe(false);
  });

  it('открытый интервал (без to) заморожен и сегодня, и сколь угодно далеко в будущем', () => {
    const h = habit({ frozenRanges: [{ from: '2026-02-01', origin: 'manual' }] });
    expect(isFrozenOn(h, '2026-01-31')).toBe(false);
    expect(isFrozenOn(h, '2026-02-01')).toBe(true);
    expect(isFrozenOn(h, '2026-06-01')).toBe(true);
  });

  it('два интервала — заморожен только внутри каждого из них, а не между', () => {
    const h = habit({
      frozenRanges: [
        { from: '2026-01-05', to: '2026-01-07', origin: 'manual' },
        { from: '2026-01-20', to: '2026-01-22', origin: 'section' },
      ],
    });
    expect(isFrozenOn(h, '2026-01-06')).toBe(true);
    expect(isFrozenOn(h, '2026-01-10')).toBe(false); // между интервалами
    expect(isFrozenOn(h, '2026-01-21')).toBe(true);
  });

  it('manual и section — просто данные, оба замораживают день одинаково', () => {
    const manual = habit({ frozenRanges: [{ from: '2026-01-01', origin: 'manual' }] });
    const section = habit({ frozenRanges: [{ from: '2026-01-01', origin: 'section' }] });
    expect(isFrozenOn(manual, '2026-01-05')).toBe(true);
    expect(isFrozenOn(section, '2026-01-05')).toBe(true);
    expect(manual.frozenRanges![0].origin).toBe('manual');
    expect(section.frozenRanges![0].origin).toBe('section');
  });
});

describe('habitStats — серия через заморозку', () => {
  it('заморозка внутри серии не рвёт её и честно считается в frozenInCurrent', () => {
    // Ежедневная привычка: выполнена 01–02 января, заморожена 03–05, снова
    // выполнена 06 (сегодня). Серия должна перешагнуть заморозку.
    const h = habit({
      schedule: { type: 'daily' },
      frozenRanges: [{ from: '2026-01-03', to: '2026-01-05', origin: 'manual' }],
    });
    const done = new Set(['2026-01-01', '2026-01-02', '2026-01-06']);
    const stats = habitStats(h, done, '2026-01-06');
    expect(stats.current).toBe(3);
    expect(stats.frozenInCurrent).toBe(3);
  });

  it('frozenInCurrent считает только дни, запланированные по расписанию', () => {
    // Привычка по понедельникам. Заморозка 06–12 января (вт–пн) захватывает
    // будни, которые и так не запланированы, и один понедельник (12-е).
    // В счёт идёт только он, а не шесть незапланированных дней.
    const h = habit({
      schedule: { type: 'weekdays', weekdays: [1] },
      frozenRanges: [{ from: '2026-01-06', to: '2026-01-12', origin: 'manual' }],
    });
    const done = new Set(['2026-01-05', '2026-01-19']); // оба — понедельники
    const stats = habitStats(h, done, '2026-01-19');
    expect(stats.current).toBe(2);
    expect(stats.frozenInCurrent).toBe(1);
  });

  it('серия 0 или заморозок в ней нет — frozenInCurrent = 0', () => {
    const h = habit({ schedule: { type: 'daily' } });
    expect(habitStats(h, new Set(), '2026-01-06').frozenInCurrent).toBe(0);
    const done = new Set(['2026-01-05', '2026-01-06']);
    expect(habitStats(h, done, '2026-01-06').frozenInCurrent).toBe(0);
  });
});
