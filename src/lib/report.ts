import { db } from '../db/db';
import { alive } from '../db/repo';
import type { Task } from '../db/types';
import { todayKey, formatRu } from './dates';
import { financeSummary, formatRub } from './finance';
import { goalProgress, goalProgressLabel } from './progress';

// Человекочитаемый markdown-отчёт по всем разделам. Для экспорта/печати.

const STATUS_RU: Record<string, string> = {
  planned: 'в планах',
  inProgress: 'в процессе',
  done: 'завершено',
  dropped: 'брошено',
};

export async function buildReport(): Promise<string> {
  const today = todayKey();
  const [tasks, goals, learning, expenses, places, energy] = await Promise.all([
    db.tasks.toArray().then(alive),
    db.goals.toArray().then(alive),
    db.learningItems.toArray().then(alive),
    db.expenseItems.toArray().then(alive),
    db.placeItems.toArray().then(alive),
    db.energyItems.toArray().then(alive),
  ]);

  const tasksByGoal = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.goalId) {
      const arr = tasksByGoal.get(t.goalId) ?? [];
      arr.push(t);
      tasksByGoal.set(t.goalId, arr);
    }
  }

  const open = tasks.filter((t) => !t.completedAt);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const doneTotal = tasks.filter((t) => t.completedAt).length;

  const L: string[] = [];
  L.push(`# Life Hub — отчёт`);
  L.push(`_${formatRu(today, 'd MMMM yyyy')}_`);
  L.push('');

  L.push(`## Задачи`);
  L.push(`- Открыто: **${open.length}**`);
  L.push(`- Просрочено: **${overdue.length}**`);
  L.push(`- Выполнено всего: **${doneTotal}**`);
  L.push('');

  const activeGoals = goals.filter((g) => g.status === 'active');
  if (activeGoals.length) {
    L.push(`## Цели (${activeGoals.length} активных)`);
    for (const g of activeGoals) {
      const linked = tasksByGoal.get(g.id) ?? [];
      L.push(`- **${g.title}** — ${goalProgressLabel(g, linked)} (${goalProgress(g, linked)}%)`);
    }
    L.push('');
  }

  if (expenses.length) {
    const s = financeSummary(expenses);
    L.push(`## Финансы (в месяц)`);
    L.push(`- Расходы: **${formatRub(s.expense)}**`);
    if (s.income > 0) L.push(`- Доходы: **${formatRub(s.income)}**`);
    L.push(`- Баланс: **${formatRub(s.balance)}**`);
    if (s.byCategory.length) {
      L.push(`- По категориям:`);
      for (const c of s.byCategory) L.push(`  - ${c.category}: ${formatRub(c.amount)}`);
    }
    L.push('');
  }

  if (learning.length) {
    const done = learning.filter((i) => i.status === 'done').length;
    const inProgress = learning.filter((i) => i.status === 'inProgress').length;
    L.push(`## Развитие`);
    L.push(`- Обучение: завершено ${done}, в процессе ${inProgress}, всего ${learning.length}`);
    for (const i of learning) {
      L.push(`  - ${i.title}${i.author ? ` — ${i.author}` : ''} (${STATUS_RU[i.status] ?? i.status})`);
    }
    L.push('');
  }

  if (energy.length || places.length) {
    L.push(`## Прочее`);
    if (energy.length) L.push(`- Способов восстановления энергии: ${energy.length}`);
    if (places.length) L.push(`- Мест и рекомендаций: ${places.length}`);
    L.push('');
  }

  return L.join('\n');
}

export function reportFilename(): string {
  return `life-hub-отчёт-${new Date().toISOString().slice(0, 10)}.md`;
}
