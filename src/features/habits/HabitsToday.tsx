import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { TaskCheck } from '../../components/ui/Checkbox';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { todayKey } from '../../lib/dates';
import { isLogDone, isPlannedOn } from './habitStreak';
import { toggleHabitDone } from './habitRepo';
import { HabitLogSheet } from './HabitLogSheet';
import type { Habit, HabitLog } from '../../db/types';

/** Блок на «Сегодня»: запланированные на сегодня привычки с быстрой отметкой.
 *  Если на сегодня привычек нет — блок скрывается целиком (return null). */
export function HabitsToday() {
  const today = todayKey();
  const [logHabit, setLogHabit] = useState<Habit | null>(null);
  const habits = alive(useLiveQuery(() => db.habits.toArray(), []) ?? []).filter(
    (h) => !h.archivedAt,
  );
  const logs = alive(useLiveQuery(() => db.habitLogs.toArray(), []) ?? []);

  const todayLogByHabit = useMemo(() => {
    const m = new Map<string, HabitLog>();
    for (const l of logs) if (l.date === today) m.set(l.habitId, l);
    return m;
  }, [logs, today]);

  const planned = habits
    .filter((h) => isPlannedOn(h.schedule, today))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (planned.length === 0) return null;

  const isDone = (h: Habit) => {
    const log = todayLogByHabit.get(h.id);
    return log ? isLogDone(h, log.value) : false;
  };
  const doneCount = planned.filter(isDone).length;
  const logValue = logHabit ? (todayLogByHabit.get(logHabit.id)?.value ?? 0) : 0;

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
          const counted = h.target != null;
          const target = h.target ?? 0;
          const value = todayLogByHabit.get(h.id)?.value ?? 0;
          const done = isDone(h);
          const pct = counted && target > 0 ? Math.min(100, (value / target) * 100) : 0;
          return (
            <div
              key={h.id}
              onClick={() => {
                if (counted) setLogHabit(h);
                else void toggleHabitDone(h.id, today, !done);
              }}
              className="flex items-center gap-3 py-3 active:opacity-80"
            >
              <span className="text-xl leading-none" aria-hidden>
                {h.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`truncate ${done ? 'text-muted line-through' : 'font-medium'}`}>
                  {h.name}
                </p>
                {counted && (
                  <p className="mt-0.5 text-xs text-muted">
                    {value}/{target}
                    {h.unit ? ` ${h.unit}` : ''}
                  </p>
                )}
              </div>
              {counted ? (
                <button
                  type="button"
                  aria-label="Ввести значение"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLogHabit(h);
                  }}
                >
                  <ProgressRing
                    value={pct}
                    size={40}
                    strokeWidth={4}
                    color={h.color}
                    label={done ? '✓' : `${value}`}
                  />
                </button>
              ) : (
                <TaskCheck
                  checked={done}
                  color={h.color}
                  onChange={() => void toggleHabitDone(h.id, today, !done)}
                />
              )}
            </div>
          );
        })}
      </div>
      <HabitLogSheet
        open={logHabit != null}
        onClose={() => setLogHabit(null)}
        habit={logHabit}
        date={today}
        currentValue={logValue}
      />
    </section>
  );
}
