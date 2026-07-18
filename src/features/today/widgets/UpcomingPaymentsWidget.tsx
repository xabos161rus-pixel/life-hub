import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { Wallet } from 'lucide-react';
import { db } from '../../../db/db';
import { alive } from '../../../db/repo';
import { todayKey } from '../../../lib/dates';
import { formatRub, upcomingExpenses } from '../../../lib/finance';

/** Текст «через N дн.» с учётом сегодня/завтра. */
function daysLeftLabel(daysLeft: number): string {
  if (daysLeft === 0) return 'сегодня';
  if (daysLeft === 1) return 'завтра';
  return `через ${daysLeft}\u00A0дн.`;
}

/** «Ближайшие платежи» — ежемесячные списания в пределах 7 дней. */
export function UpcomingPaymentsWidget() {
  const items = alive(useLiveQuery(() => db.expenseItems.toArray(), []) ?? []);

  const payments = useMemo(() => upcomingExpenses(items, todayKey(), 7), [items]);

  if (payments.length === 0) return null;

  return (
    <section className="mb-5">
      <Link
        to="/more/finance"
        className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted active:opacity-60"
      >
        <Wallet size={15} />
        Ближайшие платежи
      </Link>
      <div className="card divide-y divide-hairline px-4">
        {payments.map((p) => (
          <div key={p.item.id} className="flex items-baseline gap-2 py-3">
            <span className="min-w-0 flex-1 truncate">{p.item.title}</span>
            <span className="shrink-0 font-semibold tabular-nums text-muted">
              {formatRub(p.item.amount)}
            </span>
            <span className="shrink-0 text-xs text-muted">· {daysLeftLabel(p.daysLeft)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
