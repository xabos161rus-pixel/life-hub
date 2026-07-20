/** Чистая математика ползунка «защиты от щеки» — вынесена отдельно, чтобы
 *  тестировать без DOM и не ломать fast-refresh компонента. */

/** Доля пути, после которой отпускание считается разблокировкой. */
export const UNLOCK_AT = 0.75;

/** Ограничение позиции ручки треком. */
export function clampKnob(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/** Достаточно ли далеко сдвинута ручка, чтобы разблокировать. */
export function slidUnlocked(offset: number, maxOffset: number, threshold = UNLOCK_AT): boolean {
  return maxOffset > 0 && offset >= maxOffset * threshold;
}
