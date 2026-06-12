import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { Sun } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { formatHeaderDate, todayKey } from '../../lib/dates';
import { isScheduledOn, weekDoneCount } from '../../lib/streaks';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { TaskItem } from '../tasks/TaskItem';
import { TaskEditSheet } from '../tasks/TaskEditSheet';
import { toggleHabitLog, useHabitLogs } from '../habits/habitActions';
import { HabitCircle } from '../habits/HabitCircle';
import { GoalCard } from '../goals/GoalCard';

const EMPTY_DATES = new Set<string>();

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

/** Главный экран — дашборд дня: просрочки, задачи, привычки, цели. */
export function TodayPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const today = todayKey();

  const tasks = alive(useLiveQuery(() => db.tasks.toArray(), []) ?? []);
  const projects = alive(useLiveQuery(() => db.projects.toArray(), []) ?? []);
  const habits = alive(useLiveQuery(() => db.habits.toArray(), []) ?? []).filter(
    (h) => !h.archivedAt,
  );
  const goals = alive(useLiveQuery(() => db.goals.toArray(), []) ?? []);
  const logs = useHabitLogs();

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const datesByHabit = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of logs) {
      const set = map.get(l.habitId);
      if (set) set.add(l.date);
      else map.set(l.habitId, new Set([l.date]));
    }
    return map;
  }, [logs]);

  const byPriorityThenOrder = (a: Task, b: Task) =>
    b.priority - a.priority || a.sortOrder - b.sortOrder;

  const overdue = tasks
    .filter((t) => !t.completedAt && t.dueDate !== null && t.dueDate < today)
    .sort(
      (a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || byPriorityThenOrder(a, b),
    );

  const todayOpen = tasks
    .filter((t) => !t.completedAt && t.dueDate === today)
    .sort(byPriorityThenOrder);
  const todayDone = tasks
    .filter((t) => Boolean(t.completedAt) && t.dueDate === today)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  const todayHabits = habits
    .filter((h) => isScheduledOn(h.schedule, today))
    .sort((a, b) => a.sortOrder - b.sortOrder);

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

      {todayHabits.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-muted">Привычки</h2>
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {todayHabits.map((h) => {
              const dates = datesByHabit.get(h.id) ?? EMPTY_DATES;
              return (
                <div key={h.id} className="flex flex-col items-center gap-1">
                  <HabitCircle
                    habit={h}
                    checked={dates.has(today)}
                    onToggle={() => void toggleHabitLog(h.id, today)}
                  />
                  {h.schedule.type === 'timesPerWeek' && (
                    <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold text-muted">
                      {weekDoneCount(dates, today)}/{h.schedule.times}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
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
