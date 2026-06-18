import type { MouseEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { db } from '../../db/db';
import { create, now, update } from '../../db/repo';
import type { LearningItem } from '../../db/types';
import { todayKey } from '../../lib/dates';

const BTN_CLASS =
  'flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text active:opacity-70 disabled:opacity-40';

/** Компактный степпер прогресса: −, значение, +, для страниц ещё «+10». */
export function ProgressStepper({ item }: { item: LearningItem }) {
  const step = item.progressUnit === 'percent' ? 5 : 1;

  const setValue = async (next: number) => {
    const value = Math.max(0, Math.min(item.progressTarget, next));
    if (value === item.progressCurrent) return;
    await update(db.learningItems, item.id, { progressCurrent: value });
    // Лог на каждый клик — это ок, это история прогресса.
    await create(db.learningLogs, { itemId: item.id, date: todayKey(), value });
    if (value >= item.progressTarget && item.progressTarget > 0) {
      if (window.confirm('Отметить завершённым?')) {
        await update(db.learningItems, item.id, { status: 'done', finishedAt: now() });
      }
    }
  };

  return (
    <div
      className="flex items-center gap-2"
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
    >
      <button
        className={BTN_CLASS}
        aria-label="Уменьшить прогресс"
        disabled={item.progressCurrent <= 0}
        onClick={() => void setValue(item.progressCurrent - step)}
      >
        <Minus size={18} />
      </button>
      <span className="min-w-12 text-center font-bold tabular-nums">
        {item.progressCurrent}
        {item.progressUnit === 'percent' ? '%' : ''}
      </span>
      <button
        className={BTN_CLASS}
        aria-label="Увеличить прогресс"
        disabled={item.progressCurrent >= item.progressTarget}
        onClick={() => void setValue(item.progressCurrent + step)}
      >
        <Plus size={18} />
      </button>
      {item.progressUnit === 'pages' && (
        <button
          className={`${BTN_CLASS} w-auto px-3 text-sm font-semibold`}
          aria-label="Плюс десять страниц"
          disabled={item.progressCurrent >= item.progressTarget}
          onClick={() => void setValue(item.progressCurrent + 10)}
        >
          +10
        </button>
      )}
    </div>
  );
}
