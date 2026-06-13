import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { alive, create, remove, update } from '../../db/repo';
import type { Habit, HabitSchedule } from '../../db/types';
import { PRESET_COLORS } from '../../lib/colors';
import { WEEKDAY_LABELS } from '../../lib/dates';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  /** null/undefined — создание новой привычки */
  habit?: Habit | null;
}

type ScheduleType = HabitSchedule['type'];

const SCHEDULE_OPTIONS: { value: ScheduleType; label: string }[] = [
  { value: 'daily', label: 'Каждый день' },
  { value: 'weekdays', label: 'Дни недели' },
  { value: 'timesPerWeek', label: 'N раз в неделю' },
];

const selectClass =
  'w-full rounded-xl bg-surface-2 border border-border px-3.5 py-3 text-text outline-none focus:border-accent';

const toggleClass = (active: boolean) =>
  `flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
    active
      ? 'border-accent bg-accent/15 text-accent'
      : 'border-border bg-surface-2 text-muted'
  }`;

/** Шит создания/редактирования привычки. */
export function HabitEditSheet({ open, onClose, habit }: Props) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('✅');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [times, setTimes] = useState(3);
  const [goalId, setGoalId] = useState('');

  const goals = useLiveQuery(() => db.goals.toArray(), []) ?? [];
  const activeGoals = alive(goals)
    .filter((g) => g.status === 'active')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    if (!open) return;
    setName(habit?.name ?? '');
    setEmoji(habit?.emoji ?? '✅');
    setColor(habit?.color ?? PRESET_COLORS[0]);
    const s = habit?.schedule;
    setScheduleType(s?.type ?? 'daily');
    setWeekdays(s?.type === 'weekdays' ? s.weekdays : [1, 2, 3, 4, 5]);
    setTimes(s?.type === 'timesPerWeek' ? s.times : 3);
    setGoalId(habit?.goalId ?? '');
  }, [open, habit]);

  const canSave =
    name.trim().length > 0 && (scheduleType !== 'weekdays' || weekdays.length > 0);

  function toggleWeekday(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  const savingRef = useRef(false);
  async function save() {
    if (savingRef.current) return; // защита от дабл-тапа
    savingRef.current = true;
    try {
      const schedule: HabitSchedule =
        scheduleType === 'daily'
          ? { type: 'daily' }
          : scheduleType === 'weekdays'
            ? { type: 'weekdays', weekdays: [...weekdays].sort((a, b) => a - b) }
            : { type: 'timesPerWeek', times };
      const data = {
        name: name.trim(),
        emoji: emoji.trim() || '✅',
        color,
        schedule,
        goalId: goalId || null,
      };
      if (habit) await update(db.habits, habit.id, data);
      else await create(db.habits, { ...data, archivedAt: null, sortOrder: Date.now() });
      onClose();
    } finally {
      savingRef.current = false;
    }
  }

  async function del() {
    if (!habit) return;
    if (!window.confirm('Удалить привычку?')) return;
    await remove(db.habits, habit.id);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={habit ? 'Редактировать привычку' : 'Новая привычка'}
    >
      <div className="flex flex-col gap-4 pb-2">
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, зарядка"
          />
        </Field>

        <Field label="Эмодзи">
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">Цвет</span>
          <div className="flex flex-wrap gap-2.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Цвет ${c}`}
                className={`size-9 rounded-full border-2 transition-transform ${
                  color === c ? 'scale-110 border-text' : 'border-transparent'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">Расписание</span>
          <SegmentedControl
            options={SCHEDULE_OPTIONS}
            value={scheduleType}
            onChange={setScheduleType}
          />
        </div>

        {scheduleType === 'weekdays' && (
          <div className="flex gap-1.5">
            {WEEKDAY_LABELS.map((label, i) => (
              <button
                key={label}
                onClick={() => toggleWeekday(i + 1)}
                className={toggleClass(weekdays.includes(i + 1))}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {scheduleType === 'timesPerWeek' && (
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                onClick={() => setTimes(n)}
                className={toggleClass(times === n)}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        <Field label="Цель">
          <select
            className={selectClass}
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
          >
            <option value="">Без цели</option>
            {activeGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-1 flex flex-col gap-2.5">
          <Button onClick={() => void save()} disabled={!canSave}>
            Сохранить
          </Button>
          {habit && (
            <Button variant="danger" onClick={() => void del()}>
              Удалить
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
