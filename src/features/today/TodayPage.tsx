import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { Sun } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { formatHeaderDate, todayKey } from '../../lib/dates';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { TaskItem } from '../tasks/TaskItem';
import { TaskEditSheet } from '../tasks/TaskEditSheet';
import { GoalCard } from '../goals/GoalCard';

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
      className={`divide-y divide-border rounded-2xl border border-border bg-surface px-4 ${
        muted ? 'opacity-60' : ''
      }`}
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

  const noTasksAtAll = overdue.length === 0 && todayOpen.length === 0 && todayDone.length === 0;

  return (
    <Screen title="Сегодня" subtitle={formatHeaderDate()}>
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
