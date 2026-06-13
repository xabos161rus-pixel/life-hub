import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { differenceInCalendarDays } from 'date-fns';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Goal, Task } from '../../db/types';
import { fromKey } from '../../lib/dates';
import { goalProgress, goalProgressLabel } from '../../lib/progress';
import { ProgressRing } from '../../components/ui/ProgressRing';

/** Карточка цели — ссылка на детальную страницу, с кольцом прогресса и сроком. */
export function GoalCard({ goal }: { goal: Goal }) {
  // Для режима «по задачам» тянем живые связанные задачи сами.
  const linkedTasks =
    useLiveQuery(
      () =>
        goal.progressMode === 'tasks'
          ? db.tasks.where('goalId').equals(goal.id).toArray().then(alive)
          : Promise.resolve<Task[]>([]),
      [goal.id, goal.progressMode],
    ) ?? [];

  const value = goalProgress(goal, linkedTasks);
  const label = goalProgressLabel(goal, linkedTasks);

  let deadline: { text: string; danger: boolean } | null = null;
  if (goal.targetDate) {
    const days = differenceInCalendarDays(fromKey(goal.targetDate), new Date());
    deadline =
      days < 0
        ? { text: 'Просрочена', danger: true }
        : { text: `Осталось ${days} дн.`, danger: days < 7 };
  }

  return (
    <Link
      to={`/goals/${goal.id}`}
      className="card flex items-center gap-3.5 p-4 transition-transform active:scale-[0.99]"
    >
      <ProgressRing value={value} color={goal.color} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{goal.title}</p>
        <p className="truncate text-sm text-muted">{label}</p>
        {deadline && (
          <p className={`text-xs ${deadline.danger ? 'text-danger' : 'text-muted'}`}>
            {deadline.text}
          </p>
        )}
      </div>
    </Link>
  );
}
