import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, PiggyBank, Plus } from 'lucide-react';
import { db } from '../../db/db';
import { alive, now, update } from '../../db/repo';
import type { SavingsDeposit, SavingsGoal } from '../../db/types';
import { formatRub } from '../../lib/finance';
import { goalSaved, isReached, monthlyNeeded, progressPct, remaining } from '../../lib/savings';
import { todayKey } from '../../lib/dates';
import { SavingsGoalSheet } from './SavingsGoalSheet';
import { DepositSheet } from './DepositSheet';

function GoalCard({
  goal,
  deposits,
  onEdit,
  onDeposit,
  onClaim,
}: {
  goal: SavingsGoal;
  deposits: SavingsDeposit[];
  onEdit: () => void;
  onDeposit: () => void;
  onClaim: () => void;
}) {
  const saved = goalSaved(goal.id, deposits);
  const pct = progressPct(saved, goal.targetAmount);
  const rem = remaining(saved, goal.targetAmount);
  const reached = isReached(saved, goal.targetAmount);
  const monthly = monthlyNeeded(rem, goal.targetDate, todayKey());
  const accent = reached ? 'var(--app-success)' : goal.color;

  return (
    <div onClick={onEdit} className="card p-4 active:opacity-90">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xl leading-none"
          style={{ background: `color-mix(in oklch, ${goal.color} 16%, transparent)` }}
        >
          {goal.emoji}
        </span>
        <span className="min-w-0 flex-1 truncate font-bold">{goal.title}</span>
        <span className="shrink-0 font-extrabold tracking-tight" style={{ color: accent }}>
          {Math.round(pct)}%
        </span>
      </div>

      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            background: reached
              ? 'var(--app-success)'
              : `linear-gradient(90deg, ${goal.color}, var(--app-accent-2))`,
          }}
        />
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-xl font-extrabold tabular-nums tracking-tight">{formatRub(saved)}</span>
        <span className="shrink-0 text-sm text-muted tabular-nums">цель {formatRub(goal.targetAmount)}</span>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        {reached ? (
          <span className="flex items-center gap-1.5 text-sm font-bold text-success">
            <Check size={16} /> Цель достигнута
          </span>
        ) : (
          <span className="min-w-0 text-sm text-muted">
            осталось <b className="text-text tabular-nums">{formatRub(rem)}</b>
            {monthly ? ` · по ${formatRub(monthly)}/мес` : ''}
          </span>
        )}
        {reached ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClaim();
            }}
            className="shrink-0 rounded-xl bg-surface-2 px-4 py-2 text-sm font-bold active:opacity-70"
          >
            Забрать
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeposit();
            }}
            className="shrink-0 rounded-xl px-4 py-2 text-sm font-bold text-white active:opacity-80"
            style={{ background: `linear-gradient(140deg, ${goal.color}, var(--app-accent-2))` }}
          >
            Пополнить
          </button>
        )}
      </div>
    </div>
  );
}

export function SavingsSection() {
  const [goalSheet, setGoalSheet] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [depositGoal, setDepositGoal] = useState<SavingsGoal | null>(null);

  const goalRows = useLiveQuery(() => db.savingsGoals.toArray(), []);
  const depRows = useLiveQuery(() => db.savingsDeposits.toArray(), []);
  const goals = alive(goalRows ?? [])
    .filter((g) => !g.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const deposits = alive(depRows ?? []);

  const activeIds = new Set(goals.map((g) => g.id));
  const total = deposits.reduce((s, d) => (activeIds.has(d.goalId) ? s + d.amount : s), 0);

  const openNew = () => {
    setEditingGoal(null);
    setGoalSheet(true);
  };
  const openEdit = (g: SavingsGoal) => {
    setEditingGoal(g);
    setGoalSheet(true);
  };
  const claim = (g: SavingsGoal) => {
    if (window.confirm(`Забрать «${g.title}»? Цель уйдёт в архив.`)) {
      void update(db.savingsGoals, g.id, { archivedAt: now() });
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted">
          <PiggyBank size={15} className="shrink-0" />
          Накопления
        </h2>
        {goals.length > 0 && (
          <div className="text-right">
            <p className="text-[11px] font-medium text-muted">Всего накоплено</p>
            <p className="font-bold tabular-nums tracking-tight">{formatRub(total)}</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {goals.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            deposits={deposits}
            onEdit={() => openEdit(g)}
            onDeposit={() => setDepositGoal(g)}
            onClaim={() => claim(g)}
          />
        ))}

        <button
          type="button"
          onClick={openNew}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3.5 text-sm font-semibold text-muted active:opacity-70"
        >
          <Plus size={17} /> {goals.length === 0 ? 'Цель накопления' : 'Новая цель'}
        </button>
      </div>

      <SavingsGoalSheet open={goalSheet} onClose={() => setGoalSheet(false)} goal={editingGoal} />
      <DepositSheet
        open={depositGoal !== null}
        onClose={() => setDepositGoal(null)}
        goal={depositGoal}
      />
    </section>
  );
}
