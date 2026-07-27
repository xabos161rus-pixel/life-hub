import { describe, expect, it } from 'vitest';
import { SCROLL_EDGE, SCROLL_MAX_STEP, autoScrollStep } from './autoScroll';

// Условный контейнер 0..300 — числа сами по себе не важны, важны отступы
// от top/bottom относительно SCROLL_EDGE.
const TOP = 0;
const BOTTOM = 300;

describe('autoScrollStep', () => {
  it('на границе зоны (глубина 0) — стоим', () => {
    expect(autoScrollStep(TOP + SCROLL_EDGE, TOP, BOTTOM)).toBe(0);
    expect(autoScrollStep(BOTTOM - SCROLL_EDGE, TOP, BOTTOM)).toBe(0);
  });

  it('середина контейнера — стоим', () => {
    expect(autoScrollStep((TOP + BOTTOM) / 2, TOP, BOTTOM)).toBe(0);
  });

  it('чуть задел край зоны (глубина 2) — минимальный шаг', () => {
    expect(autoScrollStep(TOP + SCROLL_EDGE - 2, TOP, BOTTOM)).toBe(-1);
    expect(autoScrollStep(BOTTOM - SCROLL_EDGE + 2, TOP, BOTTOM)).toBe(1);
  });

  it('у самого края (глубина = SCROLL_EDGE) — максимальный шаг', () => {
    expect(autoScrollStep(TOP, TOP, BOTTOM)).toBe(-SCROLL_MAX_STEP);
    expect(autoScrollStep(BOTTOM, TOP, BOTTOM)).toBe(SCROLL_MAX_STEP);
  });

  it('палец физически за краем контейнера — шаг не растёт дальше максимума', () => {
    expect(autoScrollStep(TOP - 500, TOP, BOTTOM)).toBe(-SCROLL_MAX_STEP);
    expect(autoScrollStep(BOTTOM + 500, TOP, BOTTOM)).toBe(SCROLL_MAX_STEP);
  });

  it('верхняя зона крутит вверх (минус), нижняя — вниз (плюс)', () => {
    expect(autoScrollStep(TOP + 10, TOP, BOTTOM)).toBeLessThan(0);
    expect(autoScrollStep(BOTTOM - 10, TOP, BOTTOM)).toBeGreaterThan(0);
  });
});
