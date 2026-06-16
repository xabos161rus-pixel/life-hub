import { db } from '../db/db';
import { alive } from '../db/repo';
import type { Goal, LearningItem, Task } from '../db/types';
import { addDaysKey, todayKey } from './dates';
import { financeSummary } from './finance';
import { goalProgress } from './progress';

/** Все автоматически вычисляемые показатели приложения. */
export interface AutoMetrics {
  tasksDone7: number;
  tasksDone30: number;
  tasksAdded7: number;
  /** «Работоспособность» 0..100: доля выполненных в срок; null если нет задач с dueDate. */
  onTimeRate: number | null;
  openTasks: number;
  overdueTasks: number;
  goalsActive: number;
  /** Средний прогресс активных целей 0..100. */
  goalsAvgProgress: number;
  /** «Эффективность обучения» 0..100; null если нет элементов inProgress/done. */
  learningProgress: number | null;
  booksRead: number;
  /** Баланс из финансов, ₽/мес. */
  financeBalance: number;
  /** «Охват жизни»: сколько из 8 разделов имеют ≥1 живую запись. */
  coverage: number;
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Читает напрямую из БД и считает сводные показатели всего приложения. */
export async function computeAutoMetrics(): Promise<AutoMetrics> {
  const [
    taskRows,
    goalRows,
    metricRows,
    learningRows,
    expenseRows,
    energyRows,
    placeRows,
    noteRows,
  ] = await Promise.all([
    db.tasks.toArray(),
    db.goals.toArray(),
    db.metrics.toArray(),
    db.learningItems.toArray(),
    db.expenseItems.toArray(),
    db.energyItems.toArray(),
    db.placeItems.toArray(),
    db.notes.toArray(),
  ]);

  const tasks = alive<Task>(taskRows);
  const goals = alive<Goal>(goalRows);
  const metrics = alive(metricRows);
  const learning = alive<LearningItem>(learningRows);
  const expenses = alive(expenseRows);
  const energy = alive(energyRows);
  const places = alive(placeRows);
  const notes = alive(noteRows);

  const today = todayKey();
  const from7 = addDaysKey(today, -6); // включительно 7 дней по сегодня
  const from30 = addDaysKey(today, -29);

  // --- Задачи ---
  let tasksDone7 = 0;
  let tasksDone30 = 0;
  let tasksAdded7 = 0;
  let openTasks = 0;
  let overdueTasks = 0;
  let dueTotal = 0; // выполненные задачи, у которых был dueDate
  let dueOnTime = 0; // из них — выполненные в срок

  for (const t of tasks) {
    if (t.createdAt.slice(0, 10) >= from7) tasksAdded7 += 1;

    if (!t.completedAt) {
      openTasks += 1;
      if (t.dueDate !== null && t.dueDate < today) overdueTasks += 1;
      continue;
    }

    const doneDay = t.completedAt.slice(0, 10);
    if (doneDay >= from7) tasksDone7 += 1;
    if (doneDay >= from30) tasksDone30 += 1;

    if (t.dueDate !== null) {
      dueTotal += 1;
      if (doneDay <= t.dueDate) dueOnTime += 1;
    }
  }

  const onTimeRate = dueTotal > 0 ? clampPercent((100 * dueOnTime) / dueTotal) : null;

  // --- Цели ---
  const activeGoals = goals.filter((g) => g.status === 'active');
  let goalsProgressSum = 0;
  for (const g of activeGoals) {
    const linked = g.progressMode === 'tasks' ? tasks.filter((t) => t.goalId === g.id) : [];
    goalsProgressSum += goalProgress(g, linked);
  }
  const goalsAvgProgress =
    activeGoals.length > 0 ? clampPercent(goalsProgressSum / activeGoals.length) : 0;

  // --- Обучение ---
  const learningActive = learning.filter(
    (l) => l.status === 'inProgress' || l.status === 'done',
  );
  let learningSum = 0;
  for (const l of learningActive) {
    learningSum += l.progressTarget > 0 ? clampPercent((100 * l.progressCurrent) / l.progressTarget) : 0;
  }
  const learningProgress =
    learningActive.length > 0 ? Math.round(learningSum / learningActive.length) : null;

  const booksRead = learning.filter((l) => l.kind === 'book' && l.status === 'done').length;

  // --- Финансы ---
  const financeBalance = financeSummary(expenses).balance;

  // --- Охват жизни (8 разделов) ---
  const sections = [
    tasks.length,
    goals.length,
    metrics.length,
    learning.length,
    expenses.length,
    energy.length,
    places.length,
    notes.length,
  ];
  const coverage = sections.filter((n) => n > 0).length;

  return {
    tasksDone7,
    tasksDone30,
    tasksAdded7,
    onTimeRate,
    openTasks,
    overdueTasks,
    goalsActive: activeGoals.length,
    goalsAvgProgress,
    learningProgress,
    booksRead,
    financeBalance,
    coverage,
  };
}
