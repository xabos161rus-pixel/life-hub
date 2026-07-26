import { describe, expect, it } from 'vitest';
import { cycleDayFor, daysBetween, deriveCycles, findPeriodRuns } from './derive';
import type { BleedingLevel, CycleDayLog, CycleEpisode } from '../../db/cycleTypes';
import { MENSTRUAL_LEVELS } from '../../db/cycleTypes';

const NOW = '2026-07-25T10:00:00.000Z';

/** Короткая запись дня: 'H' обильно, 'M' умеренно, 'L' скудно, 'S' мазня,
 *  'N' явно отмечено «не было», пропуск даты в списке = нет данных. */
function day(date: string, code: 'H' | 'M' | 'L' | 'S' | 'N'): CycleDayLog {
  const bleeding: BleedingLevel = (
    { H: 'heavy', M: 'medium', L: 'light', S: 'spotting', N: 'none' } as const
  )[code];
  return {
    date,
    bleeding,
    isBleedingDay: MENSTRUAL_LEVELS.includes(bleeding) ? 1 : 0,
    createdAt: NOW,
    updatedAt: NOW,
    source: 'user',
  };
}

/** Цикл: n дней менструации с первого дня, затем явные «не было» до конца. */
function cycle(start: string, periodDays: number, cycleLength: number): CycleDayLog[] {
  const out: CycleDayLog[] = [];
  for (let i = 0; i < cycleLength; i++) {
    const d = new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000)
      .toISOString()
      .slice(0, 10);
    out.push(day(d, i < periodDays ? (i === 0 ? 'M' : i < 3 ? 'H' : 'L') : 'N'));
  }
  return out;
}

describe('daysBetween', () => {
  it('считает разницу в календарных днях', () => {
    expect(daysBetween('2026-01-01', '2026-01-02')).toBe(1);
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-03-01', '2026-01-01')).toBe(-59); // 2026 не високосный
  });

  it('не сбивается на переходе летнего времени', () => {
    // В Европе перевод часов в последнее воскресенье марта. Разница локальных
    // Date в эти сутки даёт 23 часа и округляется в 0 дней — здесь этого быть
    // не должно, потому что обе даты считаются по UTC-полуночи.
    expect(daysBetween('2026-03-28', '2026-03-29')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
  });
});

describe('findPeriodRuns', () => {
  it('склеивает подряд идущие дни кровотечения', () => {
    const runs = findPeriodRuns([
      day('2026-01-01', 'M'),
      day('2026-01-02', 'H'),
      day('2026-01-03', 'L'),
      day('2026-01-04', 'N'),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ start: '2026-01-01', end: '2026-01-03' });
  });

  it('переживает один-два сухих дня внутри менструации', () => {
    const runs = findPeriodRuns([
      day('2026-01-01', 'M'),
      day('2026-01-02', 'N'),
      day('2026-01-03', 'L'),
      day('2026-01-04', 'N'),
      day('2026-01-05', 'N'),
      day('2026-01-06', 'N'),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].end).toBe('2026-01-03');
  });

  it('рвёт менструацию после трёх сухих дней подряд', () => {
    const runs = findPeriodRuns([
      day('2026-01-01', 'M'),
      day('2026-01-02', 'N'),
      day('2026-01-03', 'N'),
      day('2026-01-04', 'N'),
      day('2026-01-05', 'L'),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0].end).toBe('2026-01-01');
    expect(runs[1].start).toBe('2026-01-05');
  });

  it('мазня не входит в менструацию и не открывает её', () => {
    const runs = findPeriodRuns([
      day('2026-01-01', 'S'),
      day('2026-01-02', 'S'),
      day('2026-01-03', 'M'),
      day('2026-01-04', 'L'),
      day('2026-01-05', 'S'),
      day('2026-01-06', 'N'),
    ]);
    expect(runs).toHaveLength(1);
    // Началось с 3-го (первое настоящее кровотечение), кончилось 4-м:
    // мазня 5-го числа в длительность не входит.
    expect(runs[0]).toMatchObject({ start: '2026-01-03', end: '2026-01-04' });
  });

  it('дни без записей не прерывают менструацию, но помечают пропуск', () => {
    const runs = findPeriodRuns([
      day('2026-01-01', 'M'),
      // 02 и 03 просто отсутствуют — человек не заходил в приложение
      day('2026-01-04', 'L'),
      day('2026-01-05', 'N'),
      day('2026-01-06', 'N'),
      day('2026-01-07', 'N'),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ start: '2026-01-01', end: '2026-01-04', gaps: true });
  });
});

describe('deriveCycles', () => {
  it('на пустых данных возвращает пустой список', () => {
    expect(deriveCycles({ days: [], today: '2026-07-25', now: NOW })).toEqual([]);
  });

  it('строит три цикла подряд и считает длины', () => {
    const days = [
      ...cycle('2026-01-01', 5, 28),
      ...cycle('2026-01-29', 4, 30),
      ...cycle('2026-02-28', 5, 27),
    ];
    const cycles = deriveCycles({ days, today: '2026-03-27', now: NOW });
    expect(cycles).toHaveLength(3);
    expect(cycles[0]).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      lengthDays: 28,
      periodLengthDays: 5,
      status: 'complete',
    });
    expect(cycles[1]).toMatchObject({ lengthDays: 30, periodLengthDays: 4 });
    // Последний цикл — текущий: длины у него нет, и подставлять «сколько
    // прошло» нельзя, иначе средняя длина поедет вниз.
    expect(cycles[2]).toMatchObject({ status: 'current' });
    expect(cycles[2].lengthDays).toBeUndefined();
    expect(cycles[2].endDate).toBeUndefined();
  });

  it('идемпотентен: повторный прогон даёт тот же результат', () => {
    const days = [...cycle('2026-01-01', 5, 28), ...cycle('2026-01-29', 4, 30)];
    const a = deriveCycles({ days, today: '2026-02-20', now: NOW });
    const b = deriveCycles({ days: [...days].reverse(), today: '2026-02-20', now: NOW });
    expect(b).toEqual(a);
  });

  it('не считает межменструальное кровотечение началом нового цикла', () => {
    const days = [
      ...cycle('2026-01-01', 5, 12),
      // Кровотечение на 13-й день цикла — слишком рано для новой менструации
      day('2026-01-13', 'L'),
      day('2026-01-14', 'L'),
      ...cycle('2026-01-15', 4, 14),
      ...cycle('2026-01-29', 5, 28),
    ];
    const cycles = deriveCycles({ days, today: '2026-02-25', now: NOW });
    // Ожидаем два цикла: 01-01 и 01-29. Ни 13-е, ни 15-е января новым циклом
    // не становятся — до них меньше 15 дней от начала.
    expect(cycles.map((c) => c.startDate)).toEqual(['2026-01-01', '2026-01-29']);
  });

  it('помечает подозрительно длинный цикл как неполный', () => {
    const days = [...cycle('2026-01-01', 5, 5), ...cycle('2026-04-01', 5, 28)];
    const cycles = deriveCycles({ days, today: '2026-04-28', now: NOW });
    expect(cycles[0].lengthDays).toBe(90);
    expect(cycles[0].hasDataGaps).toBe(1);
    expect(cycles[0].status).toBe('needs_confirmation');
  });

  it('подтверждение пользователя снимает needs_confirmation', () => {
    const days = [...cycle('2026-01-01', 5, 5), ...cycle('2026-04-01', 5, 28)];
    const cycles = deriveCycles({
      days,
      overrides: [
        { startDate: '2026-01-01', startConfirmed: 1, createdAt: NOW, updatedAt: NOW },
      ],
      today: '2026-04-28',
      now: NOW,
    });
    expect(cycles[0].status).toBe('complete');
    // Пометка о пропусках остаётся: подтверждена дата начала, а не полнота данных.
    expect(cycles[0].hasDataGaps).toBe(1);
  });

  it('правка пользователя переживает пересчёт', () => {
    const days = [...cycle('2026-01-01', 5, 28), ...cycle('2026-01-29', 5, 28)];
    const cycles = deriveCycles({
      days,
      overrides: [
        {
          startDate: '2026-01-01',
          excluded: 1,
          excludeReason: 'illness',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      today: '2026-02-26',
      now: NOW,
    });
    expect(cycles[0]).toMatchObject({ excluded: 1, excludeReason: 'illness' });
    expect(cycles[1].excluded).toBe(0);
  });

  it('исключает циклы, пересекающиеся с эпизодом', () => {
    const episodes: CycleEpisode[] = [
      {
        id: 'e1',
        kind: 'hormonal_suppression',
        startDate: '2026-02-20',
        endDate: '2026-03-30',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const days = [
      ...cycle('2026-01-01', 5, 28), // 01-01..01-28 — целиком до эпизода
      ...cycle('2026-01-29', 5, 28), // 01-29..02-25 — задевает начало эпизода
      ...cycle('2026-02-26', 5, 28), // 02-26..03-25 — целиком внутри
      ...cycle('2026-03-26', 5, 10), // текущий, начался внутри эпизода
    ];
    const cycles = deriveCycles({ days, episodes, today: '2026-04-05', now: NOW });
    expect(cycles[0].excluded).toBe(0);
    expect(cycles[1]).toMatchObject({ excluded: 1, excludeReason: 'hormonal_method' });
    expect(cycles[2].excluded).toBe(1);
    expect(cycles[3].excluded).toBe(1);
  });

  it('исключает цикл, внутри которого лежит короткий эпизод', () => {
    // Эпизод целиком внутри цикла, ни одной его границы не задевает —
    // проверка только по границам такой случай бы пропустила.
    const episodes: CycleEpisode[] = [
      {
        id: 'e2',
        kind: 'loss',
        startDate: '2026-01-10',
        endDate: '2026-01-14',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const days = [...cycle('2026-01-01', 5, 28), ...cycle('2026-01-29', 5, 28)];
    const cycles = deriveCycles({ days, episodes, today: '2026-02-26', now: NOW });
    expect(cycles[0]).toMatchObject({ excluded: 1, excludeReason: 'loss' });
    expect(cycles[1].excluded).toBe(0);
  });

  it('беременность помечает причину исключения как pregnancy', () => {
    const episodes: CycleEpisode[] = [
      {
        id: 'e3',
        kind: 'pregnancy',
        startDate: '2026-01-20',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const days = [...cycle('2026-01-01', 5, 28)];
    const cycles = deriveCycles({ days, episodes, today: '2026-02-01', now: NOW });
    expect(cycles[0]).toMatchObject({ excluded: 1, excludeReason: 'pregnancy' });
  });

  it('переживает смену года и невисокосный февраль', () => {
    const days = [...cycle('2025-12-20', 5, 28), ...cycle('2026-01-17', 5, 28)];
    const cycles = deriveCycles({ days, today: '2026-02-14', now: NOW });
    expect(cycles[0]).toMatchObject({ startDate: '2025-12-20', lengthDays: 28 });
    expect(cycles[1].startDate).toBe('2026-01-17');
  });
});

describe('cycleDayFor', () => {
  const days = [...cycle('2026-01-01', 5, 28), ...cycle('2026-01-29', 5, 28)];
  const cycles = deriveCycles({ days, today: '2026-02-26', now: NOW });

  it('первый день менструации — день 1', () => {
    expect(cycleDayFor('2026-01-01', cycles)).toBe(1);
    expect(cycleDayFor('2026-01-29', cycles)).toBe(1);
  });

  it('считает день внутри цикла', () => {
    expect(cycleDayFor('2026-01-15', cycles)).toBe(15);
    expect(cycleDayFor('2026-01-28', cycles)).toBe(28);
  });

  it('до первой записи дня цикла нет', () => {
    expect(cycleDayFor('2025-12-31', cycles)).toBeUndefined();
  });

  it('внутри эпизода день цикла не определён', () => {
    const episodes: CycleEpisode[] = [
      {
        id: 'e1',
        kind: 'hormonal_suppression',
        startDate: '2026-01-10',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    expect(cycleDayFor('2026-01-15', cycles, episodes)).toBeUndefined();
  });
});
