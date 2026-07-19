import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { AutoGrowTextarea, Field, Input } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import { PRESET_COLORS } from '../../lib/colors';
import { WEEKDAY_LABELS } from '../../lib/dates';
import type { Habit, HabitSchedule } from '../../db/types';

type SchedType = 'daily' | 'weekdays';

interface Props {
  open: boolean;
  onClose: () => void;
  item?: Habit | null;
}

export function HabitSheet({ open, onClose, item }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Привычка' : 'Новая привычка'}>
      {/* Sheet при !open размонтирует содержимое → форма всегда инициализируется
          заново из item (key меняется). */}
      <HabitForm key={item?.id ?? 'new'} item={item ?? null} onClose={onClose} />
    </Sheet>
  );
}

function HabitForm({ item, onClose }: { item: Habit | null; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [emoji, setEmoji] = useState(item?.emoji ?? '✅');
  const [color, setColor] = useState(item?.color ?? PRESET_COLORS[0]);
  const [schedType, setSchedType] = useState<SchedType>(
    item?.schedule.type === 'weekdays' ? 'weekdays' : 'daily',
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    item?.schedule.type === 'weekdays' ? item.schedule.weekdays : [1, 2, 3, 4, 5, 6, 7],
  );

  const toggleDay = (d: number) =>
    setWeekdays((w) =>
      w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort((a, b) => a - b),
    );

  const valid = Boolean(name.trim()) && (schedType === 'daily' || weekdays.length > 0);

  const savingRef = useRef(false);
  const handleSave = async () => {
    if (!valid) return;
    if (savingRef.current) return; // защита от дабл-тапа
    savingRef.current = true;
    try {
      const schedule: HabitSchedule =
        schedType === 'daily' ? { type: 'daily' } : { type: 'weekdays', weekdays };
      const base = { name: name.trim(), emoji: emoji.trim() || '✅', color, schedule };
      if (item) {
        await update(db.habits, item.id, base);
      } else {
        await create(db.habits, {
          ...base,
          goalId: null,
          archivedAt: null,
          sortOrder: Date.now(),
        });
      }
      onClose();
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!window.confirm('Удалить привычку? История отметок тоже скроется.')) return;
    await remove(db.habits, item.id);
    onClose();
  };

  return (
    <div className="space-y-4 pb-2">
      <Field label="Название">
        <AutoGrowTextarea
          value={name}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setName(e.target.value)}
          onClear={() => setName('')}
          placeholder="Например, «Отжимания»"
        />
      </Field>

      <Field label="Эмодзи">
        <Input
          value={emoji}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmoji(e.target.value)}
        />
      </Field>

      <Field label="Как часто">
        <SegmentedControl<SchedType>
          options={[
            { value: 'daily', label: 'Каждый день' },
            { value: 'weekdays', label: 'По дням недели' },
          ]}
          value={schedType}
          onChange={setSchedType}
        />
      </Field>

      {schedType === 'weekdays' && (
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, i) => {
            const d = i + 1; // 1=Пн … 7=Вс
            const active = weekdays.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`size-10 rounded-full border text-sm font-medium transition-colors ${
                  active
                    ? 'border-transparent bg-accent text-white'
                    : 'border-hairline bg-surface-2 text-muted'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div>
        <span className="mb-1.5 block text-sm font-medium text-muted">Цвет</span>
        <div className="flex flex-wrap gap-2.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Цвет ${c}`}
              onClick={() => setColor(c)}
              className={`size-9 rounded-full border-2 transition-colors ${
                color === c ? 'border-text' : 'border-transparent'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        {item && (
          <Button variant="danger" onClick={() => void handleDelete()}>
            Удалить
          </Button>
        )}
        <Button className="flex-1" disabled={!valid} onClick={() => void handleSave()}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
