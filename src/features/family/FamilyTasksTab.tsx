import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
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

  const list = useMemo(
    () =>
      (tasksRaw ?? [])
        .filter((t) => !t.deletedAt)
        .sort((a, b) => {
          if (!!a.completedAt !== !!b.completedAt) return a.completedAt ? 1 : -1; // незавершённые сверху
          return b.sortOrder - a.sortOrder;
        }),
    [tasksRaw],
  );

  const [editing, setEditing] = useState<FamilyTask | null>(null);
  const [open, setOpen] = useState(false);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (t: FamilyTask) => {
    setEditing(t);
    setOpen(true);
  };

  return (
    <div className="space-y-3">
      <Button onClick={openNew} className="w-full inline-flex items-center justify-center gap-2">
        <Plus size={18} />
        Новая задача
      </Button>

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Пока нет общих задач.</p>
      ) : (
        <div className="card divide-y divide-hairline px-4">
          {list.map((t) => {
            const done = !!t.completedAt;
            const assignee = t.assigneeId ? memberMap[t.assigneeId] : null;
            const author = memberMap[t.createdBy];
            return (
              <div key={t.id} onClick={() => openEdit(t)} className="flex items-start gap-3 py-3 active:opacity-80">
                <TaskCheck
                  checked={done}
                  onChange={() => void toggleFamilyTask(familyId, t)}
                  color={assignee?.color}
                />
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
          })}
        </div>
      )}

      <FamilyTaskSheet familyId={familyId} open={open} onClose={() => setOpen(false)} task={editing} members={members} />
    </div>
  );
}
