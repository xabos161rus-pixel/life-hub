import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Check } from 'lucide-react';
import { db } from '../../db/db';
import { alive, create, remove, update } from '../../db/repo';
import type { Goal, GoalProgressMode, GoalStatus } from '../../db/types';
import { PRESET_COLORS } from '../../lib/colors';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';

const MODE_OPTIONS: { value: GoalProgressMode; label: string }[] = [
  { value: 'manual', label: 'Вручную' },
  { value: 'tasks', label: 'По задачам' },
  { value: 'numeric', label: 'Числовой' },
];

const STATUS_OPTIONS: { value: GoalStatus; label: string }[] = [
  { value: 'active', label: 'Активна' },
  { value: 'paused', label: 'Пауза' },
  { value: 'completed', label: 'Завершена' },
  { value: 'archived', label: 'Архив' },
];

/** Шит создания/редактирования цели. goal=null|undefined — создание. */
export function GoalEditSheet({
  open,
  onClose,
  goal,
}: {
  open: boolean;
  onClose: () => void;
  goal?: Goal | null;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [targetDate, setTargetDate] = useState('');
  const [mode, setMode] = useState<GoalProgressMode>('manual');
  const [targetValue, setTargetValue] = useState('');
  const [unitLabel, setUnitLabel] = useState('');
  const [status, setStatus] = useState<GoalStatus>('active');

  useEffect(() => {
    if (!open) return;
    setTitle(goal?.title ?? '');
    setDescription(goal?.description ?? '');
    setColor(goal?.color ?? PRESET_COLORS[0]);
    setTargetDate(goal?.targetDate ?? '');
    setMode(goal?.progressMode ?? 'manual');
    setTargetValue(goal?.targetValue != null ? String(goal.targetValue) : '');
    setUnitLabel(goal?.unitLabel ?? '');
    setStatus(goal?.status ?? 'active');
  }, [open, goal]);

  const savingRef = useRef(false);
  async function handleSave() {
    const t = title.trim();
    if (!t) return;
    if (savingRef.current) return; // защита от дабл-тапа
    savingRef.current = true;
    try {
      const tvRaw = targetValue.trim() === '' ? NaN : Number(targetValue);
      const data = {
        title: t,
        description: description.trim(),
        color,
        targetDate: targetDate || null,
        progressMode: mode,
        targetValue: Number.isFinite(tvRaw) && tvRaw > 0 ? tvRaw : null,
        unitLabel: unitLabel.trim(),
      };
      if (goal) {
        await update(db.goals, goal.id, { ...data, status });
      } else {
        await create(db.goals, {
          ...data,
          status: 'active',
          progressManual: 0,
          currentValue: mode === 'numeric' ? 0 : null,
          sortOrder: Date.now(),
        });
      }
      onClose();
    } finally {
      savingRef.current = false;
    }
  }

  async function handleDelete() {
    if (!goal) return;
    if (!window.confirm(`Удалить цель «${goal.title}»?`)) return;
    const [tasks, items] = await Promise.all([
      db.tasks.where('goalId').equals(goal.id).toArray(),
      db.learningItems.where('goalId').equals(goal.id).toArray(),
    ]);
    await Promise.all([
      ...alive(tasks).map((t) => update(db.tasks, t.id, { goalId: null })),
      ...alive(items).map((li) => update(db.learningItems, li.id, { goalId: null })),
      remove(db.goals, goal.id),
    ]);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={goal ? 'Редактировать цель' : 'Новая цель'}>
      <div className="flex flex-col gap-4 pb-2">
        <Field label="Название">
          <Input
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="Например: Прочитать 20 книг"
          />
        </Field>

        <Field label="Описание">
          <Textarea
            value={description}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
            placeholder="Зачем эта цель и что считается результатом"
            rows={3}
          />
        </Field>

        <Field label="Цвет">
          <div className="flex flex-wrap gap-2.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Цвет ${c}`}
                onClick={() => setColor(c)}
                className="flex size-9 items-center justify-center rounded-full"
                style={{ background: c }}
              >
                {color === c && <Check size={18} color="#fff" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Срок (необязательно)">
          <Input
            type="date"
            value={targetDate}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetDate(e.target.value)}
          />
        </Field>

        <Field label="Прогресс">
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
        </Field>

        {mode === 'numeric' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Целевое значение">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={targetValue}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetValue(e.target.value)}
                  placeholder="20"
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Единицы">
                <Input
                  value={unitLabel}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setUnitLabel(e.target.value)}
                  placeholder="книг"
                />
              </Field>
            </div>
          </div>
        )}

        {goal && (
          <Field label="Статус">
            <SegmentedControl options={STATUS_OPTIONS} value={status} onChange={setStatus} />
          </Field>
        )}

        <div className="mt-1 flex flex-col gap-2">
          <Button
            onClick={handleSave}
            disabled={!title.trim() || (mode === 'numeric' && !(Number(targetValue) > 0))}
          >
            Сохранить
          </Button>
          {goal && (
            <Button variant="danger" onClick={handleDelete}>
              Удалить
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
