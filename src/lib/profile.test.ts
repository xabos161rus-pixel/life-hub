import { describe, expect, it } from 'vitest';
import { ageFrom, bmiFrom, yearsLabel } from './profile';

describe('возраст', () => {
  it('считается по полным годам, а не по разнице лет', () => {
    // День рождения ещё впереди — год не засчитан.
    expect(ageFrom('1998-06-29', new Date('2026-06-28T12:00:00'))).toBe(27);
    expect(ageFrom('1998-06-29', new Date('2026-06-29T00:01:00'))).toBe(28);
    expect(ageFrom('1998-12-31', new Date('2026-01-01T12:00:00'))).toBe(27);
  });

  it('молчит на пустой и бессмысленной дате', () => {
    expect(ageFrom(null)).toBeNull();
    expect(ageFrom('')).toBeNull();
    expect(ageFrom('не дата')).toBeNull();
    // Дата из будущего — не «минус год», а «нечего показывать».
    expect(ageFrom('2030-01-01', new Date('2026-08-22T12:00:00'))).toBeNull();
  });
});

describe('склонение лет', () => {
  it('русский счёт требует трёх форм', () => {
    expect(yearsLabel(21)).toBe('21 год');
    expect(yearsLabel(22)).toBe('22 года');
    expect(yearsLabel(27)).toBe('27 лет');
    // Одиннадцать-четырнадцать — исключение: «11 лет», а не «11 год».
    expect(yearsLabel(11)).toBe('11 лет');
    expect(yearsLabel(12)).toBe('12 лет');
    expect(yearsLabel(114)).toBe('114 лет');
    expect(yearsLabel(101)).toBe('101 год');
  });
});

describe('индекс массы тела', () => {
  it('считается по формуле и попадает в категорию', () => {
    expect(bmiFrom(178, 70)).toEqual({ value: 22.1, label: 'норма', tone: 'success' });
    expect(bmiFrom(178, 55)?.label).toBe('ниже нормы');
    expect(bmiFrom(178, 85)?.label).toBe('выше нормы');
    expect(bmiFrom(178, 100)?.label).toBe('значительно выше');
  });

  it('молчит, пока не хватает данных или они бессмысленны', () => {
    expect(bmiFrom(null, 70)).toBeNull();
    expect(bmiFrom(178, null)).toBeNull();
    expect(bmiFrom(0, 70)).toBeNull();
    // Рост в метрах вместо сантиметров — не повод рисовать ИМТ 70000.
    expect(bmiFrom(1.78, 70)).toBeNull();
  });
});
