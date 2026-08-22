import { t } from './i18n';

/** Полных лет на сегодня. null — дата не указана или ещё не наступила. */
export function ageFrom(birthDate: string | null | undefined, today = new Date()): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  let age = today.getFullYear() - y;
  // День рождения в этом году ещё впереди — год не засчитан.
  const before =
    today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (before) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** «27 лет», «21 год», «22 года» — русский счёт лет требует трёх форм.
 *  В английском форма одна, поэтому ветка языка живёт внутри перевода. */
export function yearsLabel(age: number): string {
  const n = age % 100;
  const d = age % 10;
  if (n >= 11 && n <= 14) return t('{n} лет', { n: age });
  if (d === 1) return t('{n} год', { n: age });
  if (d >= 2 && d <= 4) return t('{n} года', { n: age });
  return t('{n} лет', { n: age });
}

export interface Bmi {
  value: number;
  /** Категория ВОЗ — ключ перевода, а не готовая строка. */
  label: string;
  /** Цветовой токен приложения: норма зелёная, края — предупреждение. */
  tone: 'success' | 'warning';
}

/**
 * Индекс массы тела по росту и весу, которые человек и так ввёл.
 *
 * Показываем ровно то, что считает формула, и категорию ВОЗ одним словом —
 * без советов и без оценок вроде «пора худеть»: приложение не врач, а рост с
 * весом человек вводит для себя. Границы стандартные: 18,5 / 25 / 30.
 */
export function bmiFrom(heightCm: number | null | undefined, weightKg: number | null | undefined): Bmi | null {
  if (!heightCm || !weightKg || heightCm < 50 || heightCm > 260) return null;
  const m = heightCm / 100;
  const value = Math.round((weightKg / (m * m)) * 10) / 10;
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 18.5) return { value, label: 'ниже нормы', tone: 'warning' };
  if (value < 25) return { value, label: 'норма', tone: 'success' };
  if (value < 30) return { value, label: 'выше нормы', tone: 'warning' };
  return { value, label: 'значительно выше', tone: 'warning' };
}
