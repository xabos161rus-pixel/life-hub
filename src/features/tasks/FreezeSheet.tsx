import { useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Folder, Snowflake } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { formatDueDate } from '../../lib/dates';
import { freezeTasks } from './taskActions';

// Строки списка: заголовок группы (проект/подпроект/«Без проекта») или задача.
type Row =
  | { type: 'header'; key: string; project: Project | null; depth: 0 | 1; count: number }
  | { type: 'task'; task: Task; depth: 0 | 1 };

/** Иконка папки — как в разделе задач: стандартная 📁 → папка в цвете проекта. */
function GroupIcon({ project, size = 15 }: { project: Project | null; size?: number }) {
  if (!project) return <Folder size={size} aria-hidden className="text-muted" />;
  const emoji = project.emoji?.trim();
  if (emoji && emoji !== '📁')
    return <span style={{ fontSize: size - 1 }} className="leading-none">{emoji}</span>;
  return (
    <Folder
      size={size}
      aria-hidden
      style={{ color: project.color, fill: project.color, strokeWidth: 1.5 }}
    />
  );
}

/** Лист выбора задач для заморозки: та же структура, что в разделе «Задачи» —
 *  проекты (с подпроектами) в своём порядке, внутри — активные задачи. */
export function FreezeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const tasks = alive(useLiveQuery(() => db.tasks.toArray(), []) ?? []);
  const projects = alive(useLiveQuery(() => db.projects.toArray(), []) ?? [])
    .filter((p) => !p.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rows = useMemo<Row[]>(() => {
    const projectIds = new Set(projects.map((p) => p.id));
    // Кандидаты: активные (не выполненные, не замороженные), в порядке раздела.
    const byProject = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.completedAt || t.frozenAt) continue;
      const key = t.projectId && projectIds.has(t.projectId) ? t.projectId : '';
      const arr = byProject.get(key);
      if (arr) arr.push(t);
      else byProject.set(key, [t]);
    }
    for (const arr of byProject.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);

    // Иерархия как на странице задач: верхний уровень + подпроекты.
    const tops = projects.filter((p) => !p.parentId || !projectIds.has(p.parentId));
    const childrenOf = (id: string) => projects.filter((p) => p.parentId === id);

    const out: Row[] = [];
    const pushGroup = (p: Project, depth: 0 | 1) => {
      const list = byProject.get(p.id) ?? [];
      const kids = depth === 0 ? childrenOf(p.id) : [];
      const kidsHaveTasks = kids.some((k) => (byProject.get(k.id) ?? []).length > 0);
      if (!list.length && !kidsHaveTasks) return;
      out.push({ type: 'header', key: p.id, project: p, depth, count: list.length });
      for (const t of list) out.push({ type: 'task', task: t, depth });
      for (const k of kids) pushGroup(k, 1);
    };
    for (const p of tops) pushGroup(p, 0);
    const none = byProject.get('') ?? [];
    if (none.length) {
      out.push({ type: 'header', key: '', project: null, depth: 0, count: none.length });
      for (const t of none) out.push({ type: 'task', task: t, depth: 0 });
    }
    return out;
  }, [tasks, projects]);

  const candidateIds = useMemo(
    () => rows.filter((r) => r.type === 'task').map((r) => (r as { task: Task }).task.id),
    [rows],
  );

  // Сброс выбора при открытии обеспечивает remount по key из родителя.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    const ids = new Set(candidateIds.filter((id) => selected.has(id)));
    const toFreeze = tasks.filter((t) => ids.has(t.id));
    if (!toFreeze.length) return;
    await freezeTasks(toFreeze);
    toast(toFreeze.length === 1 ? 'Задача заморожена' : `Заморожено: ${toFreeze.length}`);
    onClose();
  }

  function renderRow(row: Row): ReactNode {
    if (row.type === 'header') {
      return (
        <div
          key={`h-${row.key}`}
          className={`flex items-center gap-1.5 bg-surface-2/60 px-3 py-2 ${
            row.depth ? 'pl-8' : ''
          }`}
        >
          <GroupIcon project={row.project} />
          <span className={`truncate font-semibold ${row.depth ? 'text-[13px]' : 'text-sm'}`}>
            {row.project ? row.project.name : 'Без проекта'}
          </span>
          <span className="text-xs text-muted">{row.count}</span>
        </div>
      );
    }
    const t = row.task;
    const on = selected.has(t.id);
    return (
      <button
        key={t.id}
        onClick={() => toggle(t.id)}
        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left active:opacity-70 ${
          row.depth ? 'pl-8' : ''
        }`}
      >
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
            on ? 'border-frost bg-frost text-white' : 'border-border'
          }`}
        >
          {on && <Check size={13} />}
        </span>
        <span className="min-w-0 flex-1">
          <span lang="ru" className="block break-words text-pretty hyphens-auto font-medium">
            {t.title}
          </span>
          <span className="block truncate text-xs text-muted">
            {t.dueDate ? formatDueDate(t.dueDate) : 'без срока'}
          </span>
        </span>
      </button>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Заморозить задачи">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Выберите задачи, чтобы поставить их на паузу. Они исчезнут из списка и статистики и
          перестанут напоминать — «как будто для них остановилось время». Разморозить можно в любой
          момент.
        </p>
        {candidateIds.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Нет активных задач для заморозки.</p>
        ) : (
          <div className="max-h-[50dvh] divide-y divide-hairline overflow-y-auto rounded-2xl border border-border bg-surface">
            {rows.map(renderRow)}
          </div>
        )}
        <Button
          className="inline-flex w-full items-center justify-center gap-2"
          disabled={selected.size === 0}
          onClick={() => void confirm()}
        >
          <Snowflake size={18} />
          Заморозить{selected.size > 0 ? ` (${selected.size})` : ''}
        </Button>
      </div>
    </Sheet>
  );
}
