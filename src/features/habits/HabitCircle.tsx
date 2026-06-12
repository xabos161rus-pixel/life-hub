import type { Habit } from '../../db/types';

interface Props {
  habit: Habit;
  checked: boolean;
  onToggle: () => void;
  size?: number;
}

/** Кружок привычки для блока «Сегодня»: эмодзи в круге + имя снизу. */
export function HabitCircle({ habit, checked, onToggle, size = 56 }: Props) {
  return (
    <button
      onClick={onToggle}
      aria-label={checked ? `Снять отметку: ${habit.name}` : `Отметить: ${habit.name}`}
      className="flex w-16 shrink-0 flex-col items-center gap-1 transition-transform active:scale-90"
    >
      <span
        className={`flex items-center justify-center rounded-full transition-colors ${
          checked ? '' : 'border border-border bg-surface-2'
        }`}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.42),
          background: checked ? habit.color : undefined,
        }}
      >
        {habit.emoji}
      </span>
      <span className="max-w-16 truncate text-[11px] text-muted">{habit.name}</span>
    </button>
  );
}
