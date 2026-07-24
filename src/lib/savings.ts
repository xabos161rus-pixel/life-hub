import type { SavingsDeposit } from '../db/types';

// Чистая математика накоплений — без React/Dexie, чтобы гонять юнит-тестами.
// Накоплено по цели = сумма её вкладов (вклад может быть отрицательным — снятие).

export function goalSaved(goalId: string, deposits: SavingsDeposit[]): number {
  return deposits.reduce((sum, d) => (d.goalId === goalId ? sum + d.amount : sum), 0);
}

export function totalSaved(deposits: SavingsDeposit[]): number {
  return deposits.reduce((sum, d) => sum + d.amount, 0);
}

/** Прогресс к цели в процентах, ограничен 0..100. Пустая/нулевая цель → 0. */
export function progressPct(saved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, (saved / target) * 100));
}

/** Сколько ещё нужно до цели (не отрицательное). */
export function remaining(saved: number, target: number): number {
  return Math.max(0, target - saved);
}

export function isReached(saved: number, target: number): boolean {
  return target > 0 && saved >= target;
}

/** Календарных месяцев до срока, хвостовой неполный месяц округляем вверх;
 *  0 — если срок сегодня или в прошлом. */
export function monthsUntil(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  const toBeforeOrEqual =
    ty < fy || (ty === fy && (tm < fm || (tm === fm && td <= fd)));
  if (toBeforeOrEqual) return 0;
  let months = (ty - fy) * 12 + (tm - fm);
  if (td > fd) months += 1;
  return Math.max(1, months);
}

/** Сколько откладывать в месяц, чтобы успеть к сроку. null — нет срока, цель уже
 *  достигнута или срок прошёл (тогда подсказку не показываем). */
export function monthlyNeeded(
  rem: number,
  targetDate: string | null,
  todayKey: string,
): number | null {
  if (!targetDate || rem <= 0) return null;
  const months = monthsUntil(todayKey, targetDate);
  if (months <= 0) return null;
  return Math.ceil(rem / months);
}
