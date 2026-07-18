import type { Goal, Task } from '../db/types';
import { formatNum } from './finance';
import { plural } from './plural';

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Прогресс цели 0..100 по её режиму. Для mode='tasks' передать связанные задачи. */
export function goalProgress(goal: Goal, linkedTasks: Task[] = []): number {
  switch (goal.progressMode) {
    case 'manual':
      return clamp(goal.progressManual);
    case 'numeric':
      return goal.targetValue
        ? clamp((100 * (goal.currentValue ?? 0)) / goal.targetValue)
        : 0;
    case 'tasks': {
      if (linkedTasks.length === 0) return 0;
      const done = linkedTasks.filter((t) => t.completedAt).length;
      return clamp((100 * done) / linkedTasks.length);
    }
  }
}

/** Подпись прогресса: «45%», «3 из 9 задач», «12 из 20 книг». */
export function goalProgressLabel(goal: Goal, linkedTasks: Task[] = []): string {
  switch (goal.progressMode) {
    case 'manual':
      return `${clamp(goal.progressManual)}%`;
    case 'numeric':
      return `${formatNum(goal.currentValue ?? 0)} из ${formatNum(goal.targetValue ?? 0)}${goal.unitLabel ? ` ${goal.unitLabel}` : ''}`;
    case 'tasks': {
      const done = linkedTasks.filter((t) => t.completedAt).length;
      return `${done} из ${linkedTasks.length} ${plural(linkedTasks.length, ['задачи', 'задач', 'задач'])}`;
    }
  }
}
