import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { TaskCheck } from '../../components/ui/Checkbox';
import { todayKey } from '../../lib/dates';
import { isPlannedOn } from './habitStreak';
import { setHabitDay } from './habitRepo';

/** Блок на «Сегодня»: запланированные на сегодня привычки с быстрой отметкой.
 *  Если на сегодня привычек нет — блок скрывается целиком (return null). */
export function HabitsToday() {
  const today = todayKey();
  const habits = alive(useLiveQuery(() => db.habits.toArray(), []) ?? []).filter(
    (h) => !h.archivedAt,
  );
  const logs = alive(useLiveQuery(() => db.habitLogs.toArray(), []) ?? []);

  const doneToday = useMemo(() => {
    const s = new Set<string>();
    for (const l of logs) if (l.date === today) s.add(l.habitId);
    return s;
  }, [logs, today]);

  const planned = habits
    .filter((h) => isPlannedOn(h.schedule, today))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (planned.length === 0) return null;

  const doneCount = planned.filter((h) => doneToday.has(h.id)).length;

  return (
    <section className="mb-5">
      <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-muted">
        <span>Привычки</span>
        <span className="text-xs font-normal">
          {doneCount}/{planned.length}
        </span>
      </h2>
      <div className="card divide-y divide-hairline px-4">
        {planned.map((h) => {
          const done = doneToday.has(h.id);
          return (
            <div
              key={h.id}
              onClick={() => void setHabitDay(h.id, today, !done)}
              className="flex items-center gap-3 py-3 active:opacity-80"
            >
              <span className="text-xl leading-none" aria-hidden>
                {h.emoji}
              </span>
              <p
                className={`min-w-0 flex-1 truncate ${
                  done ? 'text-muted line-through' : 'font-medium'
                }`}
              >
                {h.name}
              </p>
              <TaskCheck
                checked={done}
                color={h.color}
                onChange={() => void setHabitDay(h.id, today, !done)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
