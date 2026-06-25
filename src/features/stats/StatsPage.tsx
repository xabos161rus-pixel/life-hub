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
  skipped: number; // суммарно отмечено «пропущена» (исторически, для статистики)
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
  let skipped = 0;

  for (const t of tasks) {
    if (t.frozenAt) continue; // замороженные на паузе — в статистике не учитываем
    const items = t.checklist ?? [];
    const done = items.filter((c) => c.done).length;
    checkTotal += items.length;
    checkDone += done;
    skipped += t.skippedCount ?? 0;

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
    total: tasks.filter((t) => !t.frozenAt).length,
    completed,
    open,
    partial,
    overdue,
    skipped,
    dueToday,
    noDate,
    deleted,
    completionRate: closed === 0 ? 0 : Math.round((completed / closed) * 100),
    avgChecklist: checkTotal === 0 ? 0 : Math.round((checkDone / checkTotal) * 100),
  };
}

/** Человекочитаемая длительность: «45м», «1ч», «1ч 30м». */
function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}м`;
  return m === 0 ? `${h}ч` : `${h}ч ${m}м`;
}

/** Компактная подпись столбца графика: «45м», «2ч», «1.5ч». */
function compactDuration(min: number): string {
  if (min === 0) return '';
  if (min < 60) return `${min}м`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h}ч` : `${h.toFixed(1)}ч`;
}

interface TaskTimeStats {
  today: number; // суммарная длительность задач на сегодня, мин
  weekTotal: number; // за последние 7 дней, мин
  /** последние 7 дней (старые → новые): подпись дня + суммарные минуты */
  days: { label: string; minutes: number; isToday: boolean }[];
}

/** Запланированное время по задачам с заданной длительностью, сгруппированное
 *  по дню (Task.dueDate). Берём только задачи, у которых задан duration. */
function computeTaskTime(tasks: Task[]): TaskTimeStats {
  const today = todayKey();
  const keys = Array.from({ length: 7 }, (_, i) => addDaysKey(today, -6 + i));
  const perDay = new Map<string, number>(keys.map((k) => [k, 0]));

  for (const t of tasks) {
    if (t.duration == null || t.dueDate == null) continue;
    if (perDay.has(t.dueDate)) perDay.set(t.dueDate, (perDay.get(t.dueDate) ?? 0) + t.duration);
  }

  const days = keys.map((k) => ({
    label: WEEKDAY_LABELS[getISODay(fromKey(k)) - 1],
    minutes: perDay.get(k) ?? 0,
    isToday: k === today,
  }));

  return {
    today: perDay.get(today) ?? 0,
    weekTotal: days.reduce((s, d) => s + d.minutes, 0),
    days,
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

/** Метрика-плитка: число в собственном фоне с бордером — чтобы пункты в плотной
 *  сетке не сливались в стену цифр. */
function StatTile({ value, label, color }: { value: ReactNode; label: string; color?: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface-2 px-3 py-2.5">
      <p className="text-[22px] font-bold leading-none" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="mt-1.5 text-[11px] leading-tight text-muted">{label}</p>
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
  const taskTime = useMemo(() => computeTaskTime(tasks), [tasks]);

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

  const maxTime = useMemo(() => Math.max(1, ...taskTime.days.map((d) => d.minutes)), [taskTime]);

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
          {/* Хедлайн: процент выполнения + полоса */}
          <div className="mb-3 rounded-xl border border-hairline bg-surface-2 px-3.5 py-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-medium">Выполнено из всех</span>
              <span className="text-lg font-bold" style={{ color: 'var(--app-success)' }}>
                {taskBreakdown.completionRate}%
              </span>
            </div>
            <ProgressBar value={taskBreakdown.completionRate} color="var(--app-success)" />
          </div>

          {/* Каждая метрика — отдельная плитка, чтобы пункты не сливались */}
          <div className="grid grid-cols-3 gap-2">
            <StatTile value={taskBreakdown.total} label="всего активных" />
            <StatTile value={taskBreakdown.completed} label="выполнено" color="var(--app-success)" />
            <StatTile value={taskBreakdown.open} label="не выполнено" />
            <StatTile
              value={taskBreakdown.partial}
              label="частично"
              color={taskBreakdown.partial > 0 ? 'var(--app-warning)' : undefined}
            />
            <StatTile
              value={taskBreakdown.overdue}
              label="просрочено"
              color={taskBreakdown.overdue > 0 ? 'var(--app-danger)' : undefined}
            />
            <StatTile
              value={taskBreakdown.skipped}
              label="пропущено"
              color={taskBreakdown.skipped > 0 ? 'var(--app-warning)' : undefined}
            />
            <StatTile value={taskBreakdown.deleted} label="в корзине" />
            <StatTile value={taskBreakdown.dueToday} label="срок сегодня" />
            <StatTile value={taskBreakdown.noDate} label="без срока" />
            <StatTile value={`${taskBreakdown.avgChecklist}%`} label="чек-листы" />
          </div>
        </StatCard>

        {/* Время на задачи — суммарная длительность задач по дням */}
        {taskTime.weekTotal > 0 && (
          <StatCard title="Время на задачи">
            <div className="mb-3 rounded-xl border border-hairline bg-surface-2 px-3.5 py-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Сегодня на задачи</span>
                <span className="text-xl font-bold" style={{ color: 'var(--app-accent-2)' }}>
                  {taskTime.today > 0 ? formatDuration(taskTime.today) : '0м'}
                </span>
              </div>
            </div>

            <div className="flex items-end justify-between gap-2" style={{ height: 96 }}>
              {taskTime.days.map((d, i) => (
                <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-muted">{compactDuration(d.minutes)}</span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-md transition-[height] duration-300"
                      style={{
                        height: `${Math.round((d.minutes / maxTime) * 100)}%`,
                        minHeight: d.minutes > 0 ? 4 : 2,
                        background: 'var(--app-accent-2)',
                        opacity: d.minutes > 0 ? 1 : 0.25,
                      }}
                    />
                  </div>
                  <span className={`text-xs ${d.isToday ? 'font-bold text-text' : 'text-muted'}`}>{d.label}</span>
                </div>
              ))}
            </div>

            <p className="mt-3 text-center text-xs text-muted">
              За неделю всего: <span className="font-semibold text-text">{formatDuration(taskTime.weekTotal)}</span>
            </p>
          </StatCard>
        )}

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
