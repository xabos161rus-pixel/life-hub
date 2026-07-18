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

/** «12 500 ₽» — рубли без копеек; неразрывные пробелы и в разряде тысяч, и
 *  перед знаком валюты (сумма не разрывается переносом строки). */
export function formatRub(amount: number): string {
  const rounded = Math.round(amount);
  return `${rounded.toLocaleString('ru-RU')}\u00A0₽`;
}

/** Число с русским разделителем тысяч: 150000 → «150 000» (дробные — через запятую). */
export function formatNum(n: number): string {
  return n.toLocaleString('ru-RU');
}

export interface UpcomingPayment {
  item: ExpenseItem;
  date: string; // 'YYYY-MM-DD' ближайшего списания
  daysLeft: number;
}

/**
 * Ближайшие ежемесячные списания (расходы с recurrence='monthly' и dayOfMonth)
 * в пределах daysAhead дней. Для напоминаний на «Сегодня».
 */
export function upcomingExpenses(
  items: ExpenseItem[],
  todayKey: string,
  daysAhead = 7,
): UpcomingPayment[] {
  const today = new Date(`${todayKey}T00:00:00`);
  const result: UpcomingPayment[] = [];

  for (const item of items) {
    if (!item.active || item.kind !== 'expense') continue;
    if (item.recurrence !== 'monthly' || !item.dayOfMonth) continue;

    // ближайшая дата с этим днём месяца: этот месяц или следующий
    for (let monthOffset = 0; monthOffset <= 1; monthOffset++) {
      const y = today.getFullYear();
      const m = today.getMonth() + monthOffset;
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const day = Math.min(item.dayOfMonth, daysInMonth);
      const d = new Date(y, m, day);
      const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
      if (diff >= 0 && diff <= daysAhead) {
        const pad = (n: number) => String(n).padStart(2, '0');
        result.push({
          item,
          date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
          daysLeft: diff,
        });
        break;
      }
    }
  }
  return result.sort((a, b) => a.daysLeft - b.daysLeft);
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
