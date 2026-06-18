import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { ChevronDown, Search, Sun } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { formatHeaderDate, todayKey } from '../../lib/dates';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { QuickAddBar } from '../tasks/QuickAddBar';
import { TaskItem } from '../tasks/TaskItem';
import { TaskEditSheet } from '../tasks/TaskEditSheet';
import { GoalCard } from '../goals/GoalCard';
import { UpcomingTasksWidget } from './widgets/UpcomingTasksWidget';
import { UpcomingPaymentsWidget } from './widgets/UpcomingPaymentsWidget';
import { EnergyTipWidget } from './widgets/EnergyTipWidget';

/** Список задач в карточке — как в TasksPage. */
function TaskList({
  tasks,
  projectById,
  onEdit,
  muted,
}: {
  tasks: Task[];
  projectById: Map<string, Project>;
  onEdit: (t: Task) => void;
  muted?: boolean;
}) {
  return (
    <div
      className={`card divide-y divide-hairline px-4 ${muted ? 'opacity-60' : ''}`}
    >
      {tasks.map((t) => (
        <TaskItem
          key={t.id}
          task={t}
          project={t.projectId ? projectById.get(t.projectId) : null}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

/** Главный экран — дашборд дня: просрочки, задачи на сегодня, цели. */
export function TodayPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [inProgressCollapsed, setInProgressCollapsed] = useState(false);
  const today = todayKey();

  const tasks = alive(useLiveQuery(() => db.tasks.toArray(), []) ?? []);
  const projects = alive(useLiveQuery(() => db.projects.toArray(), []) ?? []);
  const goals = alive(useLiveQuery(() => db.goals.toArray(), []) ?? []);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const byPriorityThenOrder = (a: Task, b: Task) =>
    b.priority - a.priority || a.sortOrder - b.sortOrder;
  // Внутри сегодняшнего дня — по времени (утренние выше), затем приоритет.
  const byTimeThenPriority = (a: Task, b: Task) =>
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || byPriorityThenOrder(a, b);

  const overdue = tasks
    .filter((t) => !t.completedAt && t.dueDate !== null && t.dueDate < today)
    .sort(
      (a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || byPriorityThenOrder(a, b),
    );

  const todayOpen = tasks
    .filter((t) => !t.completedAt && t.dueDate === today)
    .sort(byTimeThenPriority);
  const todayDone = tasks
    .filter((t) => Boolean(t.completedAt) && t.dueDate === today)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  // «В работе» — живые невыполненные задачи без срока.
  const inProgress = tasks
    .filter((t) => !t.completedAt && t.dueDate === null)
    .sort(byPriorityThenOrder)
    .slice(0, 10);

  const activeGoals = goals
    .filter((g) => g.status === 'active')
    .sort((a, b) => {
      if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
      if (a.targetDate) return -1;
      if (b.targetDate) return 1;
      return a.sortOrder - b.sortOrder;
    });

  function openEdit(t: Task) {
    setEditing(t);
    setSheetOpen(true);
  }

  // Пусто только когда на экране реально нечего показать: ни задач сегодня,
  // ни просроченных, ни «в работе», ни целей — иначе EmptyState врёт.
  const noTasksAtAll =
    overdue.length === 0 &&
    todayOpen.length === 0 &&
    todayDone.length === 0 &&
    inProgress.length === 0 &&
    activeGoals.length === 0;
  const todayTotal = todayOpen.length + todayDone.length;
  const todayPct = todayTotal === 0 ? 0 : Math.round((todayDone.length / todayTotal) * 100);

  return (
    <Screen
      title="Сегодня"
      subtitle={formatHeaderDate()}
      right={
        <Link to="/search" aria-label="Поиск" className="p-1 text-accent active:opacity-60">
          <Search size={24} />
        </Link>
      }
    >
      {todayTotal > 0 && (
        <section className="card mb-4 flex items-center gap-4 px-4 py-3.5">
          <ProgressRing value={todayPct} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              Сделано {todayDone.length} из {todayTotal}
            </p>
            {overdue.length > 0 && (
              <p className="mt-0.5 text-xs font-medium text-danger">
                Просрочено: {overdue.length}
              </p>
            )}
          </div>
        </section>
      )}

      <QuickAddBar defaultDueDate={today} />

      {overdue.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-danger">Просрочено</h2>
          <TaskList tasks={overdue} projectById={projectById} onEdit={openEdit} />
        </section>
      )}

      {noTasksAtAll ? (
        <EmptyState icon={Sun} title="На сегодня задач нет" hint="Добавьте задачу кнопкой +" />
      ) : (
        (todayOpen.length > 0 || todayDone.length > 0) && (
          <section className="mb-5">
            <h2 className="mb-2 text-sm font-semibold text-muted">Задачи на сегодня</h2>
            {todayOpen.length > 0 && (
              <TaskList tasks={todayOpen} projectById={projectById} onEdit={openEdit} />
            )}
            {todayDone.length > 0 && (
              <div className={todayOpen.length > 0 ? 'mt-2' : ''}>
                <TaskList tasks={todayDone} projectById={projectById} onEdit={openEdit} muted />
              </div>
            )}
          </section>
        )
      )}

      {inProgress.length > 0 && (
        <section className="mb-5">
          <button
            type="button"
            aria-expanded={!inProgressCollapsed}
            aria-label={inProgressCollapsed ? 'Развернуть «В работе»' : 'Свернуть «В работе»'}
            onClick={() => setInProgressCollapsed((c) => !c)}
            className="mb-2 flex w-full items-center gap-1.5 text-left active:opacity-70"
          >
            <ChevronDown
              size={16}
              className={`shrink-0 text-muted transition-transform ${
                inProgressCollapsed ? '-rotate-90' : ''
              }`}
            />
            <h2 className="text-sm font-semibold text-muted">В работе</h2>
            <span className="text-xs text-muted">{inProgress.length}</span>
          </button>
          {!inProgressCollapsed && (
            <TaskList tasks={inProgress} projectById={projectById} onEdit={openEdit} />
          )}
        </section>
      )}

      {activeGoals.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-muted">Цели</h2>
          <div className="flex flex-col gap-3">
            {activeGoals.slice(0, 3).map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </div>
          {activeGoals.length > 3 && (
            <Link to="/goals" className="mt-3 block text-sm font-medium text-accent">
              Все цели →
            </Link>
          )}
        </section>
      )}

      <UpcomingTasksWidget projectById={projectById} onEdit={openEdit} />
      <UpcomingPaymentsWidget />
      <EnergyTipWidget />

      <Fab
        onClick={() => {
          setEditing(null);
          setSheetOpen(true);
        }}
      />
      <TaskEditSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        task={editing}
        defaults={{ dueDate: today }}
      />
    </Screen>
  );
}
