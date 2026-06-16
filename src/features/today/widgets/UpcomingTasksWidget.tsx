import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../../db/db';
import { alive } from '../../../db/repo';
import type { Project, Task } from '../../../db/types';
import { addDaysKey, todayKey } from '../../../lib/dates';
import { TaskItem } from '../../tasks/TaskItem';

/**
 * «Ближайшие дела» — невыполненные задачи с dueDate в диапазоне завтра..+7 дней.
 * Задачи на сегодня сюда не попадают (они показаны выше отдельной секцией).
 */
export function UpcomingTasksWidget({
  projectById,
  onEdit,
}: {
  projectById: Map<string, Project>;
  onEdit: (t: Task) => void;
}) {
  const tasks = alive(useLiveQuery(() => db.tasks.toArray(), []) ?? []);

  const upcoming = useMemo(() => {
    const from = addDaysKey(todayKey(), 1);
    const to = addDaysKey(todayKey(), 7);
    return tasks
      .filter(
        (t) => !t.completedAt && t.dueDate !== null && t.dueDate >= from && t.dueDate <= to,
      )
      .sort(
        (a, b) =>
          (a.dueDate ?? '').localeCompare(b.dueDate ?? '') ||
          (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'),
      )
      .slice(0, 5);
  }, [tasks]);

  if (upcoming.length === 0) return null;

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold text-muted">Ближайшие дела</h2>
      <div className="card divide-y divide-hairline px-4">
        {upcoming.map((t) => (
          <TaskItem
            key={t.id}
            task={t}
            project={t.projectId ? projectById.get(t.projectId) : null}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  );
}
