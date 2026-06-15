import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, FolderPlus, ListChecks, Pencil, Plus } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { Screen } from '../../components/layout/Screen';
import { Fab } from '../../components/layout/Fab';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProjectEditSheet } from './ProjectEditSheet';
import { QuickAddBar } from './QuickAddBar';
import { TaskEditSheet } from './TaskEditSheet';
import { TaskItem } from './TaskItem';

const NONE = '__none__';
const COMPLETED = '__completed__';

/** Сортировка внутри секции: ближайший срок и время выше, затем приоритет. */
function byDateTimePriority(a: Task, b: Task): number {
  return (
    (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') ||
    (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
    b.priority - a.priority ||
    a.sortOrder - b.sortOrder
  );
}

/** Сворачиваемая секция с заголовком, счётчиком и (опц.) карандашом. */
function Section({
  title,
  count,
  collapsed,
  onToggle,
  onEdit,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center gap-1 px-1">
        <button onClick={onToggle} className="flex flex-1 items-center gap-1.5 text-left">
          <ChevronDown
            size={16}
            className={`shrink-0 text-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="text-xs text-muted">{count}</span>
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            aria-label="Редактировать проект"
            className="p-1.5 text-muted active:opacity-60"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

function TaskCard({
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
          project={t.projectId ? (projectById.get(t.projectId) ?? null) : null}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

function AddTaskRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-1.5 flex items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-accent active:opacity-60"
    >
      <Plus size={15} /> Задача
    </button>
  );
}

export function TasksPage() {
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskDefaultProject, setTaskDefaultProject] = useState<string | null>(null);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  // По умолчанию свёрнут только блок «Выполненные».
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set([COMPLETED]));

  const tasksRaw = useLiveQuery(() => db.tasks.toArray(), []);
  const projectsRaw = useLiveQuery(() => db.projects.toArray(), []);

  const allTasks = alive(tasksRaw ?? []);
  // Уникальные теги из живых задач для фильтра.
  const tagOptions = useMemo(
    () => [...new Set(allTasks.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b)),
    [allTasks],
  );
  const tasks = activeTag ? allTasks.filter((t) => t.tags.includes(activeTag)) : allTasks;
  // Проекты сверху вниз в порядке создания (sortOrder растёт → новые ниже).
  const projects = alive(projectsRaw ?? [])
    .filter((p) => !p.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const loaded = tasksRaw !== undefined;

  const activeByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.completedAt) continue;
      const key = t.projectId ?? NONE;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    for (const arr of map.values()) arr.sort(byDateTimePriority);
    return map;
  }, [tasks]);

  const completed = useMemo(
    () =>
      tasks
        .filter((t) => t.completedAt)
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
        .slice(0, 50),
    [tasks],
  );

  const noProjectTasks = activeByProject.get(NONE) ?? [];

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openTask(task: Task | null, projectId: string | null) {
    setEditingTask(task);
    setTaskDefaultProject(projectId);
    setTaskSheetOpen(true);
  }

  function openProject(project: Project | null) {
    setEditingProject(project);
    setProjectSheetOpen(true);
  }

  const empty = loaded && allTasks.length === 0 && projects.length === 0;

  return (
    <Screen title="Задачи">
      <QuickAddBar />

      {tagOptions.length > 0 && (
        <div className="mb-4">
          <ChipRow>
            <Chip active={activeTag === null} onClick={() => setActiveTag(null)}>
              Все теги
            </Chip>
            {tagOptions.map((tag) => (
              <Chip
                key={tag}
                active={activeTag === tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              >
                #{tag}
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}

      {empty ? (
        <EmptyState
          icon={ListChecks}
          title="Пока нет задач"
          hint="Нажмите «+», чтобы добавить первую задачу"
        />
      ) : (
        <>
          {projects.map((p) => {
            const list = activeByProject.get(p.id) ?? [];
            return (
              <Section
                key={p.id}
                title={`${p.emoji} ${p.name}`}
                count={list.length}
                collapsed={collapsed.has(p.id)}
                onToggle={() => toggle(p.id)}
                onEdit={() => openProject(p)}
              >
                {list.length > 0 && (
                  <TaskCard tasks={list} projectById={projectById} onEdit={(t) => openTask(t, t.projectId)} />
                )}
                <AddTaskRow onClick={() => openTask(null, p.id)} />
              </Section>
            );
          })}

          {noProjectTasks.length > 0 && (
            <Section
              title="Без проекта"
              count={noProjectTasks.length}
              collapsed={collapsed.has(NONE)}
              onToggle={() => toggle(NONE)}
            >
              <TaskCard tasks={noProjectTasks} projectById={projectById} onEdit={(t) => openTask(t, null)} />
            </Section>
          )}

          {completed.length > 0 && (
            <Section
              title="Выполненные"
              count={completed.length}
              collapsed={collapsed.has(COMPLETED)}
              onToggle={() => toggle(COMPLETED)}
            >
              <TaskCard
                tasks={completed}
                projectById={projectById}
                onEdit={(t) => openTask(t, t.projectId)}
                muted
              />
            </Section>
          )}

          <button
            onClick={() => openProject(null)}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-3 text-sm font-medium text-muted active:opacity-70"
          >
            <FolderPlus size={16} /> Новый проект
          </button>
        </>
      )}

      <Fab onClick={() => openTask(null, null)} />

      <TaskEditSheet
        open={taskSheetOpen}
        onClose={() => setTaskSheetOpen(false)}
        task={editingTask}
        defaults={{ projectId: taskDefaultProject }}
      />
      <ProjectEditSheet
        open={projectSheetOpen}
        onClose={() => setProjectSheetOpen(false)}
        project={editingProject}
      />
    </Screen>
  );
}
