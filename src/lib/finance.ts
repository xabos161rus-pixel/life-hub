import type { ExpenseItem, ExpenseRecurrence } from '../db/types';

/** Множитель приведения суммы к одному месяцу. oneoff не входит в регулярную нагрузку. */
const MONTHLY_FACTOR: Record<ExpenseRecurrence, number> = {
  monthly: 1,
  weekly: 52 / 12, // ≈4.333 недели в месяце
  yearly: 1 / 12,
  oneoff: 0,
};

/** Ежемесячный эквивалент одной записи (0 для разовых). */
export function monthlyAmount(item: ExpenseItem): number {
  return item.amount * MONTHLY_FACTOR[item.recurrence];
}

export interface FinanceSummary {
  expense: number; // регулярные траты в месяц
  income: number; // регулярные доходы в месяц
  balance: number; // доход − расход
  byCategory: { category: string; amount: number }[]; // только траты, по убыванию
}

/** Сводка по активным записям: месячные траты/доходы, баланс, разбивка трат. */
export function financeSummary(items: ExpenseItem[]): FinanceSummary {
  const active = items.filter((i) => i.active);
  let expense = 0;
  let income = 0;
  const cats = new Map<string, number>();

  for (const item of active) {
    const m = monthlyAmount(item);
    if (item.kind === 'income') {
      income += m;
    } else {
      expense += m;
      const cat = item.category || 'Прочее';
      cats.set(cat, (cats.get(cat) ?? 0) + m);
    }
  }

  const byCategory = [...cats.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return { expense, income, balance: income - expense, byCategory };
}

/** «12 500 ₽» — рубли без копеек, с тонким пробелом-разделителем тысяч. */
export function formatRub(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString('ru-RU')} ₽`;
}

export const EXPENSE_CATEGORY_SUGGESTIONS = [
  'Жильё',
  'Еда',
  'Транспорт',
  'Подписки',
  'Здоровье',
  'Связь',
  'Развлечения',
  'Одежда',
  'Прочее',
];
