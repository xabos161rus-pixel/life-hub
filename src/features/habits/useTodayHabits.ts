import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { todayKey } from '../../lib/dates';
import { isActiveOn, isLogDone } from '../../lib/habits';
import type { Habit, HabitLog } from '../../db/types';

/** Привычки, запланированные на сегодня, и их состояние.
 *
 *  Живёт отдельным хуком, потому что читателей теперь двое: список на
 *  «Сегодня» и полоса дня, которая показывает счётчик, когда список свёрнут.
 *  Считать одно и то же в двух местах — верный способ разойтись в цифрах:
 *  «2 из 3» в полосе при трёх галочках в списке человек воспримет как
 *  поломку, а не как разные формулы. */
export function useTodayHabits(): {
  planned: Habit[];
  logByHabit: Map<string, HabitLog>;
  doneCount: number;
  allDone: boolean;
  isDone: (h: Habit) => boolean;
} {
  const today = todayKey();
  const habits = alive(useLiveQuery(() => db.habits.toArray(), []) ?? []).filter(
    (h) => !h.archivedAt,
  );
  const logs = alive(useLiveQuery(() => db.habitLogs.toArray(), []) ?? []);

  const logByHabit = useMemo(() => {
    const m = new Map<string, HabitLog>();
    for (const l of logs) if (l.date === today) m.set(l.habitId, l);
    return m;
  }, [logs, today]);

  const planned = useMemo(
    () => habits.filter((h) => isActiveOn(h, today)).sort((a, b) => a.sortOrder - b.sortOrder),
    [habits, today],
  );

  const isDone = (h: Habit) => {
    const log = logByHabit.get(h.id);
    return log ? isLogDone(h, log.value) : false;
  };
  const doneCount = planned.filter(isDone).length;

  return {
    planned,
    logByHabit,
    doneCount,
    // Пустой список не «выполнен»: сворачивать нечего, и полосе показывать нечего.
    allDone: planned.length > 0 && doneCount === planned.length,
    isDone,
  };
}
