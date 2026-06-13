import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ListChecks } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { Screen } from '../../components/layout/Screen';
import { Fab } from '../../components/layout/Fab';
import { EmptyState } from '../../components/ui/EmptyState';
import { todayKey } from '../../lib/dates';
import { ProjectChips } from './ProjectChips';
import { ProjectEditSheet } from './ProjectEditSheet';
import { TaskEditSheet } from './TaskEditSheet';
import { TaskItem } from './TaskItem';

function byPriority(a: Task, b: Task): number {
  return b.priority - a.priority || a.sortOrder - b.sortOrder;
}

/** Внутри одного дня: по времени (с временем — раньше), затем по приоритету. */
function byTimeThenPriority(a: Task, b: Task): number {
  return (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') || byPriority(a, b);
}

function TaskGroup({
  title,
  danger = false,
  tasks,
  projectById,
  onEdit,
}: {
  title: string;
  danger?: boolean;
  tasks: Task[];
  projectById: Map<string, Project>;
  onEdit: (t: Task) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="mb-5">
      <h2 className={`mb-2 text-sm font-semibold ${danger ? 'text-danger' : 'text-muted'}`}>
        {title}
      </h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4">
        {tasks.map((t) => (
          <TaskItem
            key={t.id}
            task={t}
            project={t.projectId ? (projectById.get(t.projectId) ?? null) : null}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  );
}

export function TasksPage() {
  const [filter, setFilter] = useState<string | null>(null);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);

  const aliveTasks = alive(tasks ?? []);
  const aliveProjects = alive(projects ?? []);
  const projectById = new Map(aliveProjects.map((p) => [p.id, p]));

  // Если проект фильтра удалён или заархивирован — сбрасываем фильтр.
  useEffect(() => {
    if (
      filter &&
      projects &&
      !alive(projects).some((p) => p.id === filter && !p.archivedAt)
    ) {
      setFilter(null);
    }
  }, [filter, projects]);

  const filtered = filter ? aliveTasks.filter((t) => t.projectId === filter) : aliveTasks;
  const today = todayKey();
  const active = filtered.filter((t) => !t.completedAt);

  const overdue = active.filter((t) => t.dueDate && t.dueDate < today).sort(byPriority);
  const dueToday = active.filter((t) => t.dueDate === today).sort(byTimeThenPriority);
  const upcoming = active
    .filter((t) => t.dueDate && t.dueDate > today)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || byPriority(a, b));
  const noDate = active.filter((t) => !t.dueDate).sort(byPriority);

  const completed = filtered
    .filter((t) => t.completedAt)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const completedShown = completed.slice(0, 50);

  const loaded = tasks !== undefined;

  const handleEditTask = (t: Task) => {
    setEditingTask(t);
    setTaskSheetOpen(true);
  };

  return (
    <Screen title="Задачи">
      <ProjectChips
        value={filter}
        onChange={setFilter}
        onEditProject={(p) => {
          setEditingProject(p);
          setProjectSheetOpen(true);
        }}
      />

      <div className="mt-4">
        {loaded && aliveTasks.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Пока нет задач"
            hint="Нажмите «+», чтобы добавить первую задачу"
          />
        ) : loaded && filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">В этом проекте пока нет задач</p>
        ) : (
          <>
            <TaskGroup
              title="Просрочено"
              danger
              tasks={overdue}
              projectById={projectById}
              onEdit={handleEditTask}
            />
            <TaskGroup
              title="Сегодня"
              tasks={dueToday}
              projectById={projectById}
              onEdit={handleEditTask}
            />
            <TaskGroup
              title="Предстоящие"
              tasks={upcoming}
              projectById={projectById}
              onEdit={handleEditTask}
            />
            <TaskGroup
              title="Без даты"
              tasks={noDate}
              projectById={projectById}
              onEdit={handleEditTask}
            />

            {completed.length > 0 && (
              <section className="mb-5">
                <button
                  onClick={() => setShowCompleted((v) => !v)}
                  className="mb-2 flex items-center gap-1 text-sm font-semibold text-muted"
                >
                  <ChevronDown
                    size={16}
                    className={`transition-transform ${showCompleted ? '' : '-rotate-90'}`}
                  />
                  Выполненные ({completed.length})
                </button>
                {showCompleted && (
                  <div className="divide-y divide-border rounded-2xl border border-border bg-surface px-4">
                    {completedShown.map((t) => (
                      <TaskItem
                        key={t.id}
                        task={t}
                        project={t.projectId ? (projectById.get(t.projectId) ?? null) : null}
                        onEdit={handleEditTask}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <Fab
        onClick={() => {
          setEditingTask(null);
          setTaskSheetOpen(true);
        }}
      />

      <TaskEditSheet
        open={taskSheetOpen}
        onClose={() => setTaskSheetOpen(false)}
        task={editingTask}
        defaults={{ projectId: filter }}
      />
      <ProjectEditSheet
        open={projectSheetOpen}
        onClose={() => setProjectSheetOpen(false)}
        project={editingProject}
      />
    </Screen>
  );
}
