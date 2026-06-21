import { useState } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import type { FamilyTask, FamilyMember, Priority } from '../../db/types';
import { createFamilyTask, updateFamilyTask, deleteFamilyTask } from '../../lib/family/familyRepo';

interface Props {
  familyId: string;
  open: boolean;
  onClose: () => void;
  task: FamilyTask | null;
  members: FamilyMember[];
}

type PStr = '0' | '1' | '2' | '3';
const PRIORITIES: { value: PStr; label: string }[] = [
  { value: '0', label: 'Нет' },
  { value: '1', label: 'Низкий' },
  { value: '2', label: 'Средний' },
  { value: '3', label: 'Высокий' },
];

export function FamilyTaskSheet({ familyId, open, onClose, task, members }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={task ? 'Задача' : 'Новая задача'}>
      <FamilyTaskForm key={task?.id ?? 'new'} familyId={familyId} task={task} members={members} onClose={onClose} />
    </Sheet>
  );
}

function FamilyTaskForm({ familyId, task, members, onClose }: { familyId: string; task: FamilyTask | null; members: FamilyMember[]; onClose: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [priority, setPriority] = useState<PStr>(String(task?.priority ?? 0) as PStr);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(task?.assigneeId ?? null);
  const alive = members.filter((m) => !m.leftAt);

  async function save() {
    if (!title.trim()) return;
    const data = { title, notes, priority: Number(priority) as Priority, dueDate: dueDate || null, assigneeId };
    if (task) await updateFamilyTask(familyId, task.id, data);
    else await createFamilyTask(familyId, data);
    onClose();
  }

  async function remove() {
    if (!task) return;
    if (!window.confirm('Удалить задачу?')) return;
    await deleteFamilyTask(familyId, task.id);
    onClose();
  }

  return (
    <div className="space-y-4 pb-2">
      <Field label="Что нужно сделать">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название задачи" />
      </Field>
      <Field label="Кому">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAssigneeId(null)}
            className={`rounded-full px-3 py-1.5 text-sm ${assigneeId === null ? 'bg-accent text-white' : 'bg-surface-2 text-muted'}`}
          >
            Всем
          </button>
          {alive.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setAssigneeId(m.id)}
              className={`rounded-full px-3 py-1.5 text-sm ${assigneeId === m.id ? 'text-white' : 'bg-surface-2 text-muted'}`}
              style={assigneeId === m.id ? { background: m.color } : undefined}
            >
              {m.displayName}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Приоритет">
        <SegmentedControl options={PRIORITIES} value={priority} onChange={setPriority} />
      </Field>
      <Field label="Срок">
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      <Field label="Детали">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Заметки…" rows={2} />
      </Field>
      <div className="flex gap-2 pt-1">
        {task && (
          <Button variant="danger" onClick={() => void remove()}>
            Удалить
          </Button>
        )}
        <Button className="flex-1" disabled={!title.trim()} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
