import { useMemo } from 'react';
import { Pencil } from 'lucide-react';
import type { Habit, HabitLog } from '../../db/types';
import { WEEKDAY_LABELS } from '../../lib/dates';
import { currentStreak, weekDoneCount } from '../../lib/streaks';
import { toggleHabitLog } from './habitActions';
import { Heatmap } from './Heatmap';

interface Props {
  habit: Habit;
  logs: HabitLog[];
  onEdit: (h: Habit) => void;
}

function pluralTimes(n: number): string {
  return n === 1 ? 'раз' : n < 5 ? 'раза' : 'раз';
}

function describeSchedule(habit: Habit): string {
  const s = habit.schedule;
  switch (s.type) {
    case 'daily':
      return 'Каждый день';
    case 'weekdays': {
      const days = [...s.weekdays].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d - 1]);
      return days.length ? `По ${days.join(', ')}` : 'Дни не выбраны';
    }
    case 'timesPerWeek':
      return `${s.times} ${pluralTimes(s.times)} в неделю`;
  }
}

/** Карточка привычки: серия, heatmap с ретро-отметкой, расписание. */
export function HabitCard({ habit, logs, onEdit }: Props) {
  const doneDates = useMemo(() => new Set(logs.map((l) => l.date)), [logs]);
  const streak = currentStreak(habit, doneDates);
  const sched = habit.schedule;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
          style={{ background: `${habit.color}33` }}
        >
          {habit.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{habit.name}</p>
          <p className="text-sm text-muted">
            {sched.type === 'timesPerWeek'
              ? `Серия: ${streak} нед. · ${weekDoneCount(doneDates)} из ${sched.times} на этой неделе`
              : `Серия: ${streak} дн.`}
          </p>
        </div>
        <button
          onClick={() => onEdit(habit)}
          aria-label="Редактировать"
          className="rounded-full bg-surface-2 p-2 text-muted"
        >
          <Pencil size={16} />
        </button>
      </div>
      <div className="mt-3">
        <Heatmap
          habit={habit}
          doneDates={doneDates}
          onToggleDay={(date) => void toggleHabitLog(habit.id, date)}
        />
        <p className="mt-2 text-xs text-muted">{describeSchedule(habit)}</p>
      </div>
    </div>
  );
}
