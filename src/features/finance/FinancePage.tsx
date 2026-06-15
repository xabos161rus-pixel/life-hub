import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wallet } from 'lucide-react';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { ExpenseItem, ExpenseRecurrence } from '../../db/types';
import { financeSummary, formatRub } from '../../lib/finance';
import { ExpenseSheet } from './ExpenseSheet';

const RECURRENCE_LABEL: Record<ExpenseRecurrence, string> = {
  monthly: 'Ежемесячно',
  weekly: 'Еженедельно',
  yearly: 'Ежегодно',
  oneoff: 'Разово',
};

function SummaryCard({ items }: { items: ExpenseItem[] }) {
  const summary = financeSummary(items);
  const balancePositive = summary.balance >= 0;
  return (
    <div className="card p-4">
      <p className="text-sm font-medium text-muted">Расходы в месяц</p>
      <p className="mt-0.5 text-3xl font-bold tracking-[-0.02em]">{formatRub(summary.expense)}</p>
      <p className="mt-1 text-sm text-muted">≈ {formatRub(summary.expense * 12)} в год</p>

      {(summary.income > 0 || summary.balance !== 0) && (
        <div className="mt-3 flex gap-2">
          {summary.income > 0 && (
            <div className="flex-1 rounded-xl bg-surface-2 px-3 py-2">
              <p className="text-xs text-muted">Доход</p>
              <p className="font-semibold text-success">{formatRub(summary.income)}</p>
            </div>
          )}
          <div className="flex-1 rounded-xl bg-surface-2 px-3 py-2">
            <p className="text-xs text-muted">Баланс</p>
            <p className={`font-semibold ${balancePositive ? 'text-success' : 'text-danger'}`}>
              {formatRub(summary.balance)}
            </p>
          </div>
        </div>
      )}

      {summary.byCategory.length > 0 && (
        <div className="mt-4 space-y-2.5">
          {summary.byCategory.map((c) => (
            <div key={c.category}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-text">{c.category}</span>
                <span className="shrink-0 text-muted">{formatRub(c.amount)}</span>
              </div>
              <div className="mt-1">
                <ProgressBar
                  value={summary.expense > 0 ? (100 * c.amount) / summary.expense : 0}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpenseRow({ item, onOpen }: { item: ExpenseItem; onOpen: () => void }) {
  const isIncome = item.kind === 'income';
  const sign = isIncome ? '+' : '−';
  return (
    <div
      onClick={onOpen}
      className={`flex items-start gap-3 py-3 active:opacity-80 ${item.active ? '' : 'opacity-50'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold">{item.title}</p>
          {!item.active && (
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              не учитывается
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {!isIncome && item.category && (
            <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-muted">
              {item.category}
            </span>
          )}
          <span className="text-xs text-muted">{RECURRENCE_LABEL[item.recurrence]}</span>
        </div>
      </div>
      <span
        className={`shrink-0 font-semibold tabular-nums ${isIncome ? 'text-success' : 'text-danger'}`}
      >
        {sign} {formatRub(item.amount)}
      </span>
    </div>
  );
}

export function FinancePage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseItem | null>(null);

  const rows = useLiveQuery(() => db.expenseItems.toArray(), []);
  const items = alive(rows ?? []).sort((a, b) => a.sortOrder - b.sortOrder);

  const expenses = items.filter((i) => i.kind === 'expense');
  const incomes = items.filter((i) => i.kind === 'income');

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (item: ExpenseItem) => {
    setEditing(item);
    setSheetOpen(true);
  };

  return (
    <Screen title="Финансы" backTo="/more">
      {items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Пока нет записей"
          hint="Добавьте ежемесячные траты — аренду, подписки, еду — и увидите, сколько уходит в месяц и в год."
        />
      ) : (
        <div className="space-y-5">
          <SummaryCard items={items} />

          {expenses.length > 0 && (
            <section>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Расходы</h2>
              <div className="card divide-y divide-hairline px-4">
                {expenses.map((item) => (
                  <ExpenseRow key={item.id} item={item} onOpen={() => openEdit(item)} />
                ))}
              </div>
            </section>
          )}

          {incomes.length > 0 && (
            <section>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Доходы</h2>
              <div className="card divide-y divide-hairline px-4">
                {incomes.map((item) => (
                  <ExpenseRow key={item.id} item={item} onOpen={() => openEdit(item)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Fab onClick={openCreate} />
      <ExpenseSheet open={sheetOpen} onClose={() => setSheetOpen(false)} item={editing} />
    </Screen>
  );
}
