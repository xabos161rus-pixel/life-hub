import { useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChartColumnBig, Share2 } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Goal, LearningItem, Task } from '../../db/types';
import { addDaysKey, fromKey, todayKey, WEEKDAY_LABELS } from '../../lib/dates';
import { getISODay } from 'date-fns';
import { goalProgress, goalProgressLabel } from '../../lib/progress';
import { financeSummary, formatRub } from '../../lib/finance';
import { buildReport, reportFilename } from '../../lib/report';
import { Screen } from '../../components/layout/Screen';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';

interface TaskStats {
  /** последние 7 дней (старые → новые): подпись дня + число выполненных */
  week: { label: string; count: number }[];
}

/** Недельная гистограмма выполненных задач. Производные от текущей даты — здесь. */
function computeTaskStats(tasks: Task[]): TaskStats {
  const today = todayKey();
  // Бакеты по дням последней недели: ключ даты → счётчик выполненных.
  const weekKeys = Array.from({ length: 7 }, (_, i) => addDaysKey(today, -6 + i));
  const weekCount = new Map<string, number>(weekKeys.map((k) => [k, 0]));

  for (const t of tasks) {
    if (!t.completedAt) continue;
    const day = t.completedAt.slice(0, 10);
    if (weekCount.has(day)) weekCount.set(day, (weekCount.get(day) ?? 0) + 1);
  }

  const week = weekKeys.map((k) => ({
    label: WEEKDAY_LABELS[getISODay(fromKey(k)) - 1],
    count: weekCount.get(k) ?? 0,
  }));

  return { week };
}

interface TaskBreakdown {
  total: number; // активных (не удалённых)
  completed: number; // выполнено полностью
  open: number; // не выполнено
  partial: number; // выполнено не полностью (чеклист начат, но не закончен)
  overdue: number; // просрочено (из невыполненных)
  dueToday: number; // срок — сегодня
  noDate: number; // без срока (из невыполненных)
  deleted: number; // в корзине
  completionRate: number; // % выполнения (выполнено / выполнено+открыто)
  avgChecklist: number; // средний прогресс по всем пунктам чеклистов, %
}

/** Разбор задач по статусам. tasks — живые (без удалённых), deleted — счётчик корзины. */
function computeTaskBreakdown(tasks: Task[], deleted: number): TaskBreakdown {
  const today = todayKey();
  let completed = 0;
  let open = 0;
  let partial = 0;
  let overdue = 0;
  let dueToday = 0;
  let noDate = 0;
  let checkDone = 0;
  let checkTotal = 0;

  for (const t of tasks) {
    const items = t.checklist ?? [];
    const done = items.filter((c) => c.done).length;
    checkTotal += items.length;
    checkDone += done;

    if (t.completedAt) {
      completed += 1;
      continue;
    }
    open += 1;
    if (t.dueDate !== null && t.dueDate < today) overdue += 1;
    else if (t.dueDate === today) dueToday += 1;
    if (t.dueDate === null) noDate += 1;
    if (items.length > 0 && done > 0 && done < items.length) partial += 1;
  }

  const closed = completed + open;
  return {
    total: tasks.length,
    completed,
    open,
    partial,
    overdue,
    dueToday,
    noDate,
    deleted,
    completionRate: closed === 0 ? 0 : Math.round((completed / closed) * 100),
    avgChecklist: checkTotal === 0 ? 0 : Math.round((checkDone / checkTotal) * 100),
  };
}

function StatCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

function StatNumber({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div>
      <p className="text-2xl font-bold" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

/** Экран статистики/обзора продуктивности. */
export function StatsPage() {
  const allTasks = useLiveQuery<Task[]>(() => db.tasks.toArray(), []) ?? [];
  const tasks = alive(allTasks);
  const deletedTasks = allTasks.length - tasks.length;
  const goals = alive(useLiveQuery<Goal[]>(() => db.goals.toArray(), []) ?? []);
  const learning = alive(useLiveQuery<LearningItem[]>(() => db.learningItems.toArray(), []) ?? []);
  const expenses = alive(useLiveQuery(() => db.expenseItems.toArray(), []) ?? []);
  const toast = useToast();

  async function handleShareReport() {
    const md = await buildReport();
    const file = new File([md], reportFilename(), { type: 'text/markdown' });

    // share-шит — только на iOS (там это путь в «Файлы»); на десктопе
    // системный share-диалог блокирует страницу, качаем напрямую
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (err) {
        // AbortError — пользователь закрыл шит шаринга, это не ошибка
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          alert('Не удалось поделиться отчётом');
        }
        return;
      }
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    toast('Отчёт готов');
  }

  const taskStats = useMemo(() => computeTaskStats(tasks), [tasks]);
  const taskBreakdown = useMemo(() => computeTaskBreakdown(tasks, deletedTasks), [tasks, deletedTasks]);

  const tasksByGoal = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.goalId) continue;
      const arr = map.get(t.goalId);
      if (arr) arr.push(t);
      else map.set(t.goalId, [t]);
    }
    return map;
  }, [tasks]);

  const activeGoals = useMemo(
    () =>
      goals
        .filter((g) => g.status === 'active')
        .map((g) => {
          const linked = g.progressMode === 'tasks' ? (tasksByGoal.get(g.id) ?? []) : [];
          return { goal: g, value: goalProgress(g, linked), label: goalProgressLabel(g, linked) };
        }),
    [goals, tasksByGoal],
  );

  const avgGoalProgress = useMemo(
    () =>
      activeGoals.length === 0
        ? 0
        : Math.round(activeGoals.reduce((s, g) => s + g.value, 0) / activeGoals.length),
    [activeGoals],
  );

  const topGoals = useMemo(
    () => [...activeGoals].sort((a, b) => b.value - a.value).slice(0, 3),
    [activeGoals],
  );

  const learningStats = useMemo(
    () => ({
      done: learning.filter((l) => l.status === 'done').length,
      inProgress: learning.filter((l) => l.status === 'inProgress').length,
    }),
    [learning],
  );

  const finance = useMemo(() => financeSummary(expenses), [expenses]);

  const maxWeek = useMemo(
    () => Math.max(1, ...taskStats.week.map((d) => d.count)),
    [taskStats],
  );

  const noData =
    tasks.length === 0 &&
    goals.length === 0 &&
    learning.length === 0 &&
    expenses.length === 0;

  if (noData) {
    return (
      <Screen title="Статистика" backTo="/more">
        <EmptyState
          icon={ChartColumnBig}
          title="Пока нет данных"
          hint="Добавьте задачи, цели или другие записи — здесь появится обзор продуктивности"
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Статистика"
      backTo="/more"
      right={
        <button
          onClick={() => void handleShareReport()}
          aria-label="Поделиться отчётом"
          className="-mr-2 p-1 text-accent active:opacity-60"
        >
          <Share2 size={22} />
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Эффективность — разбор задач по статусам */}
        <StatCard title="Эффективность">
          <div className="grid grid-cols-3 gap-y-4">
            <StatNumber value={taskBreakdown.total} label="всего активных" />
            <StatNumber value={taskBreakdown.completed} label="выполнено" color="var(--app-success)" />
            <StatNumber value={taskBreakdown.open} label="не выполнено" />
            <StatNumber
              value={taskBreakdown.partial}
              label="частично"
              color={taskBreakdown.partial > 0 ? 'var(--app-warning)' : undefined}
            />
            <StatNumber
              value={taskBreakdown.overdue}
              label="просрочено"
              color={taskBreakdown.overdue > 0 ? 'var(--app-danger)' : undefined}
            />
            <StatNumber value={taskBreakdown.deleted} label="в корзине" color="var(--app-muted)" />
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs text-muted">Выполнено из всех</span>
              <span className="text-xs font-semibold">{taskBreakdown.completionRate}%</span>
            </div>
            <ProgressBar value={taskBreakdown.completionRate} color="var(--app-success)" />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-y-4">
            <StatNumber value={taskBreakdown.dueToday} label="срок сегодня" />
            <StatNumber value={taskBreakdown.noDate} label="без срока" />
            <div>
              <p className="text-2xl font-bold">{taskBreakdown.avgChecklist}%</p>
              <p className="text-xs text-muted">прогресс чек-листов</p>
            </div>
          </div>
        </StatCard>

        {/* За неделю — гистограмма выполненных задач по дням */}
        <StatCard title="За неделю">
          <div className="flex items-end justify-between gap-2" style={{ height: 96 }}>
            {taskStats.week.map((d, i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="text-xs font-semibold text-muted">{d.count > 0 ? d.count : ''}</span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-md bg-accent transition-[height] duration-300"
                    style={{
                      height: `${Math.round((d.count / maxWeek) * 100)}%`,
                      minHeight: d.count > 0 ? 4 : 2,
                      opacity: d.count > 0 ? 1 : 0.25,
                    }}
                  />
                </div>
                <span className="text-xs text-muted">{d.label}</span>
              </div>
            ))}
          </div>
        </StatCard>

        {/* Цели */}
        {activeGoals.length > 0 && (
          <StatCard title="Цели">
            <div className="mb-4 grid grid-cols-2 gap-y-4">
              <StatNumber value={activeGoals.length} label="активных" />
              <div>
                <p className="text-2xl font-bold">{avgGoalProgress}%</p>
                <p className="text-xs text-muted">средний прогресс</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {topGoals.map(({ goal, value, label }) => (
                <div key={goal.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm font-medium">{goal.title}</span>
                    <span className="shrink-0 text-xs text-muted">{label}</span>
                  </div>
                  <ProgressBar value={value} color={goal.color} />
                </div>
              ))}
            </div>
          </StatCard>
        )}

        {/* Развитие */}
        {learning.length > 0 && (
          <StatCard title="Развитие">
            <p className="mb-3 text-sm text-muted">
              Обучение:{' '}
              <span className="font-semibold text-text">{learningStats.done} завершено</span>
              {' / '}
              <span className="font-semibold text-text">
                {learningStats.inProgress} в процессе
              </span>
            </p>
          </StatCard>
        )}

        {/* Финансы */}
        {expenses.length > 0 && (
          <StatCard title="Финансы">
            <div className="grid grid-cols-2 gap-y-4">
              <div>
                <p className="text-2xl font-bold">{formatRub(finance.expense)}</p>
                <p className="text-xs text-muted">расходы в месяц</p>
              </div>
              <div>
                <p
                  className="text-2xl font-bold"
                  style={{
                    color:
                      finance.balance < 0 ? 'var(--app-danger)' : 'var(--app-success)',
                  }}
                >
                  {formatRub(finance.balance)}
                </p>
                <p className="text-xs text-muted">баланс</p>
              </div>
            </div>
          </StatCard>
        )}
      </div>
    </Screen>
  );
}
