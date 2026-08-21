import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLoaded } from '../../hooks/useLoaded';
import {
  GChevronRight as ChevronRight,
  GPlus as Plus,
} from '../../components/ui/glyphs';
import { db } from '../../db/db';
import type { FamilyTask } from '../../db/types';
import { TaskCheck } from '../../components/ui/Checkbox';
import { Button } from '../../components/ui/Button';
import { formatDueDate } from '../../lib/dates';
import { toggleFamilyTask } from '../../lib/family/familyRepo';
import { FamilyTaskSheet } from './FamilyTaskSheet';
import { t } from '../../lib/i18n';
import { ICON } from '../../components/ui/icons';

export function FamilyTasksTab({ familyId }: { familyId: string }) {
  const tasksRaw = useLiveQuery(() => db.familyTasks.where('familyId').equals(familyId).toArray(), [familyId]);
  const loaded = useLoaded(tasksRaw);
  const membersRaw = useLiveQuery(() => db.familyMembers.where('familyId').equals(familyId).toArray(), [familyId]);
  const members = useMemo(() => membersRaw ?? [], [membersRaw]);
  const memberMap = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);

  const tasks = useMemo(() => (tasksRaw ?? []).filter((task) => !task.deletedAt), [tasksRaw]);
  const active = useMemo(
    () => tasks.filter((task) => !task.completedAt).sort((a, b) => b.sortOrder - a.sortOrder),
    [tasks],
  );
  const completed = useMemo(
    () => tasks.filter((task) => task.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [tasks],
  );

  const [editing, setEditing] = useState<FamilyTask | null>(null);
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false); // выполненные свёрнуты по умолчанию

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (task: FamilyTask) => {
    setEditing(task);
    setOpen(true);
  };

  const renderRow = (task: FamilyTask) => {
    const done = !!task.completedAt;
    const assignee = task.assigneeId ? memberMap[task.assigneeId] : null;
    const author = memberMap[task.createdBy];
    return (
      <div key={task.id} onClick={() => openEdit(task)} className="flex items-start gap-3 py-3 active:opacity-80">
        <TaskCheck checked={done} onChange={() => void toggleFamilyTask(familyId, task)} color={assignee?.color} />
        <div className="min-w-0 flex-1">
          <p className={`break-words ${done ? 'text-muted line-through' : 'font-medium'}`}>{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {author && <span>{t('от {name}', { name: author.displayName })}</span>}
            <span style={assignee ? { color: assignee.color } : undefined}>
              → {assignee ? assignee.displayName : t('всем')}
            </span>
            {task.dueDate && <span>· {formatDueDate(task.dueDate)}</span>}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <Button onClick={openNew} className="w-full inline-flex items-center justify-center gap-2">
        <Plus size={ICON.base} />
        {t('Новая задача')}
      </Button>

      {active.length === 0 && completed.length === 0 ? (
        loaded && <p className="py-10 text-center text-sm text-muted">{t('Пока нет общих задач.')}</p>
      ) : (
        <>
          {active.length > 0 && <div className="card divide-y divide-hairline px-4">{active.map(renderRow)}</div>}

          {completed.length > 0 && (
            <div>
              <button
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-sm text-muted active:opacity-60"
              >
                <ChevronRight size={ICON.inline} className={`shrink-0 transition-transform ${showDone ? 'rotate-90' : ''}`} />
                <span>{t('Выполненные')}</span>
                <span className="text-xs">{completed.length}</span>
              </button>
              {showDone && (
                <div className="card mt-1 divide-y divide-hairline px-4 opacity-70">{completed.map(renderRow)}</div>
              )}
            </div>
          )}
        </>
      )}

      <FamilyTaskSheet familyId={familyId} open={open} onClose={() => setOpen(false)} task={editing} members={members} />
    </div>
  );
}
