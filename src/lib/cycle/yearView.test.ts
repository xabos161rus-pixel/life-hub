import { describe, expect, it } from 'vitest';
import { buildYearOverview, lastMonthKeys, type YearDaySource } from './yearView';
import type { Cycle, LocalDate } from '../../db/cycleTypes';

const NOW = '2026-07-25T10:00:00.000Z';

function cycle(startDate: LocalDate, opts: Partial<Cycle> = {}): Cycle {
  return {
    startDate,
    status: 'complete',
    excluded: 0,
    hasDataGaps: 0,
    startConfirmed: 0,
    derivedAt: NOW,
    ...opts,
  };
}

function days(entries: Record<LocalDate, YearDaySource['bleeding']>): Map<LocalDate, YearDaySource> {
  return new Map(Object.entries(entries).map(([date, bleeding]) => [date, { bleeding }]));
}

describe('lastMonthKeys', () => {
  it('отдаёт 12 месяцев от текущего к самому старому', () => {
    const keys = lastMonthKeys('2026-07-25');
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('2026-07');
    expect(keys.at(-1)).toBe('2025-08');
  });

  it('переходит через границу года назад', () => {
    const keys = lastMonthKeys('2026-01-15');
    expect(keys[0]).toBe('2026-01');
    expect(keys[1]).toBe('2025-12');
    expect(keys.at(-1)).toBe('2025-02');
  });
});

describe('buildYearOverview: месяцы и клетки', () => {
  it('строит 12 строк по 31 клетке, текущий месяц сверху', () => {
    const view = buildYearOverview(new Map(), [], '2026-07-25');
    expect(view.months).toHaveLength(12);
    expect(view.months[0].key).toBe('2026-07');
    expect(view.months[0].label).toBe('Июль 2026');
    expect(view.months.every((m) => m.days.length === 31)).toBe(true);
  });

  it('у месяцев короче 31 дня хвост клеток без даты', () => {
    const view = buildYearOverview(new Map(), [], '2026-07-25');
    const feb = view.months.find((m) => m.key === '2026-02')!;
    // Февраль 2026 (не високосный) — 28 дней.
    expect(feb.days[27].date).toBe('2026-02-28');
    expect(feb.days[28].date).toBeUndefined();
    expect(feb.days[30].date).toBeUndefined();
  });

  it('дни позже today помечены future и без данных', () => {
    const data = days({ '2026-07-28': 'heavy' });
    const view = buildYearOverview(data, [], '2026-07-25');
    const july = view.months[0];
    const day28 = july.days[27];
    expect(day28.date).toBe('2026-07-28');
    expect(day28.future).toBe(true);
    // Данные будущего дня демонстративно не читаются, даже если они есть в базе.
    expect(day28.bleeding).toBeUndefined();
    expect(day28.ariaLabel).toBeUndefined();

    const day25 = july.days[24];
    expect(day25.future).toBe(false);
  });

  it('не помечает future дни ни в одном месяце, кроме текущего', () => {
    const view = buildYearOverview(new Map(), [], '2026-07-25');
    const june = view.months[1];
    expect(june.days.every((d) => d.future === false)).toBe(true);
  });

  it('кодирует уровень кровотечения и spotting отдельно от него', () => {
    const data = days({
      '2026-07-10': 'heavy',
      '2026-07-11': 'spotting',
      '2026-07-12': 'none',
    });
    const view = buildYearOverview(data, [], '2026-07-25');
    const july = view.months[0];
    expect(july.days[9].bleeding).toBe('heavy');
    expect(july.days[10].bleeding).toBe('spotting');
    // Явное «не было» — это не то же самое, что заливка клетки.
    expect(july.days[11].bleeding).toBeUndefined();
  });

  it('собирает aria-label с датой и содержимым для значимых клеток', () => {
    const data = days({ '2026-07-14': 'heavy' });
    const view = buildYearOverview(data, [cycle('2026-07-14')], '2026-07-25');
    const cell = view.months[0].days[13];
    expect(cell.ariaLabel).toBe('14 июля, менструация, обильно, начало цикла');
  });

  it('не даёт aria-label пустым клеткам прошлого', () => {
    const view = buildYearOverview(new Map(), [], '2026-07-25');
    const emptyPastDay = view.months[0].days[0]; // 1 июля — есть в базе, но без записи
    expect(emptyPastDay.ariaLabel).toBeUndefined();
  });

  it('помечает начало цикла даже без записи о кровотечении в этот день', () => {
    const view = buildYearOverview(new Map(), [cycle('2026-06-01')], '2026-07-25');
    const june = view.months.find((m) => m.key === '2026-06')!;
    expect(june.days[0].isCycleStart).toBe(true);
    expect(june.days[0].ariaLabel).toBe('1 июня, начало цикла');
  });
});

describe('buildYearOverview: список циклов периода', () => {
  it('включает только завершённые циклы, начавшиеся в пределах 12 месяцев', () => {
    const cycles = [
      cycle('2020-01-01', { lengthDays: 28, endDate: '2020-01-28' }), // старше периода
      cycle('2026-05-01', { lengthDays: 30, endDate: '2026-05-30', periodLengthDays: 5 }),
      cycle('2026-06-10', { lengthDays: 26, endDate: '2026-07-05', periodLengthDays: 4 }),
      cycle('2026-07-06', { status: 'current' }), // текущий, ещё не завершён
    ];
    const view = buildYearOverview(new Map(), cycles, '2026-07-25');
    expect(view.cycles).toHaveLength(2);
    // Новее — сверху, тем же порядком, что и месяцы.
    expect(view.cycles[0].startDate).toBe('2026-06-10');
    expect(view.cycles[0].lengthDays).toBe(26);
    expect(view.cycles[0].periodLengthDays).toBe(4);
    expect(view.cycles[1].startDate).toBe('2026-05-01');
  });

  it('не скрывает исключённые циклы, а помечает их', () => {
    const cycles = [
      cycle('2026-06-01', { lengthDays: 45, endDate: '2026-07-15', excluded: 1, excludeReason: 'illness' }),
    ];
    const view = buildYearOverview(new Map(), cycles, '2026-07-25');
    expect(view.cycles).toHaveLength(1);
    expect(view.cycles[0].excluded).toBe(true);
  });
});
