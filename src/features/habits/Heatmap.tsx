import type { Habit } from '../../db/types';
import { heatmapWeeks } from '../../lib/streaks';

interface Props {
  habit: Habit;
  doneDates: Set<string>;
  /** ретро-отметка: тап по ячейке прошлого/сегодня */
  onToggleDay?: (date: string) => void;
}

/** Мини-heatmap привычки: колонки — недели, строки — дни Пн..Вс. */
export function Heatmap({ habit, doneDates, onToggleDay }: Props) {
  const weeks = heatmapWeeks(habit, doneDates);
  return (
    <div className="grid w-fit grid-flow-col grid-rows-7 gap-[3px]">
      {weeks.flat().map((cell) => {
        const cls = cell.future
          ? 'invisible'
          : cell.done
            ? ''
            : cell.scheduled
              ? 'bg-surface-2'
              : 'bg-surface-2/30';
        return (
          <button
            key={cell.date}
            type="button"
            disabled={cell.future || !onToggleDay}
            onClick={() => onToggleDay?.(cell.date)}
            aria-label={cell.date}
            className={`size-2.5 rounded-[3px] ${cls}`}
            style={cell.done ? { background: habit.color } : undefined}
          />
        );
      })}
    </div>
  );
}
