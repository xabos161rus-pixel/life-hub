import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X } from 'lucide-react';
import { db } from '../../db/db';
import { alive, create, remove, uid, update } from '../../db/repo';
import type { ChecklistItem, Priority, Recurrence, Task } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { TaskCheck } from '../../components/ui/Checkbox';
import { MicButton } from '../../components/ui/MicButton';
import { addDaysKey, todayKey, WEEKDAY_LABELS } from '../../lib/dates';
import { PRESET_COLORS } from '../../lib/colors';

type RecType = 'none' | 'daily' | 'weekly' | 'monthly';
type PriorityStr = '0' | '1' | '2' | '3';

const selectClass =
  'w-full appearance-none rounded-xl bg-surface-2 border border-border px-3.5 py-3 text-text outline-none focus:border-accent';

const PRIORITY_OPTIONS: { value: PriorityStr; label: string }[] = [
  { value: '0', label: 'Нет' },
  { value: '1', label: 'Низкий' },
  { value: '2', label: 'Средний' },
  { value: '3', label: 'Высокий' },
];

const REC_OPTIONS: { value: RecType; label: string }[] = [
  { value: 'none', label: 'Нет' },
  { value: 'daily', label: 'День' },
  { value: 'weekly', label: 'Неделя' },
  { value: 'monthly', label: 'Месяц' },
];

const REC_INTERVAL_LABELS: Record<Exclude<RecType, 'none'>, string> = {
  daily: 'Интервал (дней)',
  weekly: 'Интервал (недель)',
  monthly: 'Интервал (месяцев)',
};

/** Шит создания/редактирования задачи. task=null → создание с defaults. */
export function TaskEditSheet({
  open,
  onClose,
  task,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaults?: { projectId?: string | null; goalId?: string | null; dueDate?: string | null };
}) {
  const projects =
    useLiveQuery(
      async () =>
        alive(await db.projects.toArray())
          .filter((p) => !p.archivedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      [],
    ) ?? [];
  const goals =
    useLiveQuery(
      async () => alive(await db.goals.toArray()).filter((g) => g.status === 'active'),
      [],
    ) ?? [];

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>(0);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [recType, setRecType] = useState<RecType>('none');
  const [recInterval, setRecInterval] = useState('1');
  const [recWeekdays, setRecWeekdays] = useState<number[]>([]);
  const [recDayOfMonth, setRecDayOfMonth] = useState('1');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newItem, setNewItem] = useState('');

  // Инлайн-создание проекта прямо из шита задачи (#1).
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(PRESET_COLORS[0]);
  const [newProjectEmoji, setNewProjectEmoji] = useState('📁');

  // Инициализация формы при каждом открытии шита.
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setNotes(task.notes);
      setProjectId(task.projectId);
      setGoalId(task.goalId);
      setPriority(task.priority);
      setDueDate(task.dueDate);
      setDueTime(task.dueTime ?? null);
      setChecklist(task.checklist.map((i) => ({ ...i })));
      const rec = task.recurrence;
      setRecType(rec?.type ?? 'none');
      setRecInterval(String(rec?.interval ?? 1));
      setRecWeekdays(rec?.type === 'weekly' ? [...rec.weekdays] : []);
      setRecDayOfMonth(String(rec?.type === 'monthly' ? rec.dayOfMonth : 1));
    } else {
      setTitle('');
      setNotes('');
      setProjectId(defaults?.projectId ?? null);
      setGoalId(defaults?.goalId ?? null);
      setPriority(0);
      setDueDate(defaults?.dueDate ?? null);
      setDueTime(null);
      setChecklist([]);
      setRecType('none');
      setRecInterval('1');
      setRecWeekdays([]);
      setRecDayOfMonth('1');
    }
    setNewItem('');
    setShowNewProject(false);
    setNewProjectName('');
    setNewProjectColor(PRESET_COLORS[0]);
    setNewProjectEmoji('📁');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const buildRecurrence = (): Recurrence | null => {
    const interval = Math.max(1, parseInt(recInterval, 10) || 1);
    switch (recType) {
      case 'none':
        return null;
      case 'daily':
        return { type: 'daily', interval };
      case 'weekly':
        return { type: 'weekly', interval, weekdays: [...recWeekdays].sort((a, b) => a - b) };
      case 'monthly':
        return {
          type: 'monthly',
          interval,
          dayOfMonth: Math.min(31, Math.max(1, parseInt(recDayOfMonth, 10) || 1)),
        };
    }
  };

  const savingRef = useRef(false);
  const handleSave = async () => {
    if (savingRef.current) return; // защита от дабл-тапа: не плодим дубликаты
    savingRef.current = true;
    try {
      const data = {
        title: title.trim(),
        notes: notes.trim(),
        projectId,
        goalId,
        priority,
        dueDate,
        dueTime: dueDate ? dueTime : null,
        checklist,
        recurrence: buildRecurrence(),
      };
      if (task) {
        await update(db.tasks, task.id, data);
      } else {
        await create(db.tasks, { ...data, completedAt: null, sortOrder: Date.now() });
      }
      onClose();
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!window.confirm('Удалить задачу?')) return;
    await remove(db.tasks, task.id);
    onClose();
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const project = await create(db.projects, {
      name,
      color: newProjectColor,
      emoji: newProjectEmoji.trim() || '📁',
      sortOrder: Date.now(),
      archivedAt: null,
    });
    setProjectId(project.id);
    setShowNewProject(false);
    setNewProjectName('');
    setNewProjectColor(PRESET_COLORS[0]);
    setNewProjectEmoji('📁');
  };

  const addChecklistItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setChecklist((items) => [...items, { id: uid(), text, done: false }]);
    setNewItem('');
  };

  const handleNewItemKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addChecklistItem();
    }
  };

  const tomorrow = addDaysKey(todayKey(), 1);

  return (
    <Sheet open={open} onClose={onClose} title={task ? 'Задача' : 'Новая задача'}>
      <div className="flex flex-col gap-4 pb-2">
        <Field label="Название">
          <div className="flex items-center gap-2">
            <Input
              value={title}
              placeholder="Что нужно сделать?"
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1"
            />
            <MicButton
              onText={(t) => setTitle((prev) => (prev ? `${prev} ${t}` : t))}
            />
          </div>
        </Field>

        <Field label="Заметки">
          <div className="flex items-start gap-2">
            <Textarea
              rows={2}
              value={notes}
              placeholder="Детали…"
              onChange={(e) => setNotes(e.target.value)}
              className="flex-1"
            />
            <MicButton
              onText={(t) => setNotes((prev) => (prev ? `${prev} ${t}` : t))}
            />
          </div>
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Проект</span>
            {!showNewProject && (
              <button
                type="button"
                className="text-sm font-medium text-accent"
                onClick={() => setShowNewProject(true)}
              >
                + Новый
              </button>
            )}
          </div>
          {showNewProject ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={newProjectEmoji}
                  placeholder="📁"
                  onChange={(e) => setNewProjectEmoji(e.target.value)}
                  className="w-14! shrink-0 text-center"
                />
                <Input
                  value={newProjectName}
                  placeholder="Название проекта"
                  autoFocus
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="min-w-0 flex-1"
                />
              </div>
              <div className="flex flex-wrap gap-2.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Цвет ${c}`}
                    onClick={() => setNewProjectColor(c)}
                    className="size-7 rounded-full transition-transform active:scale-90"
                    style={{
                      backgroundColor: c,
                      outline: newProjectColor === c ? `2px solid ${c}` : 'none',
                      outlineOffset: '2px',
                    }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowNewProject(false);
                    setNewProjectName('');
                  }}
                >
                  Отмена
                </Button>
                <Button
                  className="flex-1"
                  disabled={!newProjectName.trim()}
                  onClick={handleCreateProject}
                >
                  Создать
                </Button>
              </div>
            </div>
          ) : (
            <select
              className={selectClass}
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value || null)}
            >
              <option value="">Без проекта</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <Field label="Цель">
          <select
            className={selectClass}
            value={goalId ?? ''}
            onChange={(e) => setGoalId(e.target.value || null)}
          >
            <option value="">Без цели</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Приоритет">
          <SegmentedControl
            options={PRIORITY_OPTIONS}
            value={String(priority) as PriorityStr}
            onChange={(v) => setPriority(Number(v) as Priority)}
          />
        </Field>

        <div>
          <Field label="Срок">
            <div className="flex gap-2">
              <Input
                type="date"
                value={dueDate ?? ''}
                onChange={(e) => setDueDate(e.target.value || null)}
                className="flex-1"
              />
              {dueDate && (
                <Input
                  type="time"
                  value={dueTime ?? ''}
                  onChange={(e) => setDueTime(e.target.value || null)}
                  className="w-32"
                />
              )}
            </div>
          </Field>
          <div className="mt-2">
            <ChipRow>
              <Chip active={dueDate === todayKey()} onClick={() => setDueDate(todayKey())}>
                Сегодня
              </Chip>
              <Chip active={dueDate === tomorrow} onClick={() => setDueDate(tomorrow)}>
                Завтра
              </Chip>
              <Chip
                onClick={() => {
                  setDueDate(null);
                  setDueTime(null);
                }}
              >
                Убрать
              </Chip>
            </ChipRow>
          </div>
        </div>

        <Field label="Повторение">
          <SegmentedControl options={REC_OPTIONS} value={recType} onChange={setRecType} />
        </Field>

        {recType !== 'none' && (
          <Field label={REC_INTERVAL_LABELS[recType]}>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={recInterval}
              onChange={(e) => setRecInterval(e.target.value)}
            />
          </Field>
        )}

        {recType === 'weekly' && (
          <ChipRow>
            {WEEKDAY_LABELS.map((label, i) => {
              const day = i + 1;
              const on = recWeekdays.includes(day);
              return (
                <Chip
                  key={day}
                  active={on}
                  onClick={() =>
                    setRecWeekdays(
                      on ? recWeekdays.filter((d) => d !== day) : [...recWeekdays, day],
                    )
                  }
                >
                  {label}
                </Chip>
              );
            })}
          </ChipRow>
        )}

        {recType === 'monthly' && (
          <Field label="День месяца">
            <Input
              type="number"
              min={1}
              max={31}
              inputMode="numeric"
              value={recDayOfMonth}
              onChange={(e) => setRecDayOfMonth(e.target.value)}
            />
          </Field>
        )}

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">Чеклист</span>
          {checklist.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 py-1">
              <TaskCheck
                size={22}
                checked={item.done}
                onChange={() =>
                  setChecklist((arr) =>
                    arr.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
                  )
                }
              />
              <span className={`flex-1 text-sm ${item.done ? 'text-muted line-through' : ''}`}>
                {item.text}
              </span>
              <button
                aria-label="Удалить пункт"
                className="shrink-0 p-1 text-muted"
                onClick={() => setChecklist((arr) => arr.filter((i) => i.id !== item.id))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <Input
            className="mt-1"
            value={newItem}
            placeholder="Добавить пункт"
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={handleNewItemKey}
          />
        </div>

        <div className="mt-1 flex gap-2">
          {task && (
            <Button variant="danger" onClick={handleDelete}>
              Удалить
            </Button>
          )}
          <Button className="flex-1" disabled={!title.trim()} onClick={handleSave}>
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
