import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLoaded } from '../../hooks/useLoaded';
import { Sun } from 'lucide-react';
import {
  GSearch as Search,
} from '../../components/ui/glyphs';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { formatHeaderDate, todayKey } from '../../lib/dates';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { QuickAddBar } from '../tasks/QuickAddBar';
import { CycleTodayLine } from '../cycle/CycleTodayLine';
import { TaskItem } from '../tasks/TaskItem';
import { TaskEditSheet } from '../tasks/TaskEditSheet';
import { WeatherWidget } from './widgets/WeatherWidget';
import { RemindersBlock } from './RemindersBlock';
import { HabitsToday } from '../habits/HabitsToday';
import { ProtectDataCard } from './ProtectDataCard';
import { IconButton } from '../../components/ui/IconButton';

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
    <div className={`card divide-y divide-hairline px-4 ${muted ? 'opacity-60' : ''}`}>
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

/** Главный экран — погода, напоминания (далее) и задачи на сегодня. */
export function TodayPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const today = todayKey();

  // Сырые значения держим отдельно: undefined значит «Dexie ещё не ответил»,
  // и это не то же самое, что «задач нет». Склей их — и на первом кадре
  // самого посещаемого экрана вспыхивает «На сегодня задач нет».
  const tasksRaw = useLiveQuery(() => db.tasks.toArray(), []);
  const projectsRaw = useLiveQuery(() => db.projects.toArray(), []);
  const loaded = useLoaded(tasksRaw, projectsRaw);
  const tasks = alive(tasksRaw ?? []);
  const projects = alive(projectsRaw ?? []);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const byPriorityThenOrder = (a: Task, b: Task) =>
    b.priority - a.priority || a.sortOrder - b.sortOrder;
  // Внутри сегодняшнего дня — по времени (утренние выше), затем приоритет.
  const byTimeThenPriority = (a: Task, b: Task) =>
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || byPriorityThenOrder(a, b);

  const overdue = tasks
    .filter((t) => !t.completedAt && !t.frozenAt && t.dueDate !== null && t.dueDate < today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || byPriorityThenOrder(a, b));

  const todayOpen = tasks
    .filter((t) => !t.completedAt && !t.frozenAt && t.dueDate === today)
    .sort(byTimeThenPriority);
  const todayDone = tasks
    .filter((t) => Boolean(t.completedAt) && t.dueDate === today)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  function openEdit(t: Task) {
    setEditing(t);
    setSheetOpen(true);
  }

  const noTasks = overdue.length === 0 && todayOpen.length === 0 && todayDone.length === 0;

  return (
    <Screen
      title="Сегодня"
      subtitle={formatHeaderDate()}
      right={
        <IconButton icon={Search} label="Поиск" to="/search" />
      }
    >
      <WeatherWidget />

      <ProtectDataCard />

      {/* Строка раздела «Женские дни». Сама решает, показываться ли: без
          включённого переключателя и без данных цикла ничего не рисует. */}
      <CycleTodayLine />

      <RemindersBlock />

      <HabitsToday />

      <QuickAddBar defaultDueDate={today} />

      {overdue.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-warning">Просрочено</h2>
          <TaskList tasks={overdue} projectById={projectById} onEdit={openEdit} />
        </section>
      )}

      {noTasks ? (
        loaded && <EmptyState icon={Sun} title="На сегодня задач нет" hint="Добавьте задачу кнопкой +" />
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
