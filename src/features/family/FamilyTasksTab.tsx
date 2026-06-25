import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Plus } from 'lucide-react';
import { db } from '../../db/db';
import type { FamilyTask } from '../../db/types';
import { TaskCheck } from '../../components/ui/Checkbox';
import { Button } from '../../components/ui/Button';
import { formatDueDate } from '../../lib/dates';
import { toggleFamilyTask } from '../../lib/family/familyRepo';
import { FamilyTaskSheet } from './FamilyTaskSheet';

export function FamilyTasksTab({ familyId }: { familyId: string }) {
  const tasksRaw = useLiveQuery(() => db.familyTasks.where('familyId').equals(familyId).toArray(), [familyId]);
  const membersRaw = useLiveQuery(() => db.familyMembers.where('familyId').equals(familyId).toArray(), [familyId]);
  const members = useMemo(() => membersRaw ?? [], [membersRaw]);
  const memberMap = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);

  const tasks = useMemo(() => (tasksRaw ?? []).filter((t) => !t.deletedAt), [tasksRaw]);
  const active = useMemo(
    () => tasks.filter((t) => !t.completedAt).sort((a, b) => b.sortOrder - a.sortOrder),
    [tasks],
  );
  const completed = useMemo(
    () => tasks.filter((t) => t.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [tasks],
  );

  const [editing, setEditing] = useState<FamilyTask | null>(null);
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false); // выполненные свёрнуты по умолчанию

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (t: FamilyTask) => {
    setEditing(t);
    setOpen(true);
  };

  const renderRow = (t: FamilyTask) => {
    const done = !!t.completedAt;
    const assignee = t.assigneeId ? memberMap[t.assigneeId] : null;
    const author = memberMap[t.createdBy];
    return (
      <div key={t.id} onClick={() => openEdit(t)} className="flex items-start gap-3 py-3 active:opacity-80">
        <TaskCheck checked={done} onChange={() => void toggleFamilyTask(familyId, t)} color={assignee?.color} />
        <div className="min-w-0 flex-1">
          <p className={`break-words ${done ? 'text-muted line-through' : 'font-medium'}`}>{t.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {author && <span>от {author.displayName}</span>}
            <span style={assignee ? { color: assignee.color } : undefined}>
              → {assignee ? assignee.displayName : 'всем'}
            </span>
            {t.dueDate && <span>· {formatDueDate(t.dueDate)}</span>}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <Button onClick={openNew} className="w-full inline-flex items-center justify-center gap-2">
        <Plus size={18} />
        Новая задача
      </Button>

      {active.length === 0 && completed.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Пока нет общих задач.</p>
      ) : (
        <>
          {active.length > 0 && <div className="card divide-y divide-hairline px-4">{active.map(renderRow)}</div>}

          {completed.length > 0 && (
            <div>
              <button
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-sm text-muted active:opacity-60"
              >
                <ChevronRight size={14} className={`shrink-0 transition-transform ${showDone ? 'rotate-90' : ''}`} />
                <span>Выполненные</span>
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
