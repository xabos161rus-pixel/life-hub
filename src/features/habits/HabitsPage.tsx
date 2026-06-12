import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Flame } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Habit, HabitLog } from '../../db/types';
import { todayKey } from '../../lib/dates';
import { isScheduledOn, weekDoneCount } from '../../lib/streaks';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { toggleHabitLog, useHabitLogs } from './habitActions';
import { HabitCard } from './HabitCard';
import { HabitCircle } from './HabitCircle';
import { HabitEditSheet } from './HabitEditSheet';

const EMPTY_DATES = new Set<string>();

export function HabitsPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);

  const habitsRaw = useLiveQuery(() => db.habits.toArray(), []) ?? [];
  const habits = alive(habitsRaw)
    .filter((h) => !h.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const logs = useHabitLogs();
  const today = todayKey();

  const { logsByHabit, datesByHabit } = useMemo(() => {
    const logsByHabit = new Map<string, HabitLog[]>();
    const datesByHabit = new Map<string, Set<string>>();
    for (const l of logs) {
      const arr = logsByHabit.get(l.habitId);
      if (arr) arr.push(l);
      else logsByHabit.set(l.habitId, [l]);
      const set = datesByHabit.get(l.habitId);
      if (set) set.add(l.date);
      else datesByHabit.set(l.habitId, new Set([l.date]));
    }
    return { logsByHabit, datesByHabit };
  }, [logs]);

  const todayHabits = habits.filter((h) => isScheduledOn(h.schedule, today));

  function openEdit(h: Habit) {
    setEditing(h);
    setSheetOpen(true);
  }

  return (
    <Screen title="Привычки">
      {habits.length === 0 ? (
        <EmptyState
          icon={Flame}
          title="Пока нет привычек"
          hint="Нажмите «+» и добавьте первую — например, зарядку или чтение перед сном."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {todayHabits.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted">Сегодня</h2>
              <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {todayHabits.map((h) => {
                  const dates = datesByHabit.get(h.id) ?? EMPTY_DATES;
                  return (
                    <div key={h.id} className="flex flex-col items-center gap-1">
                      <HabitCircle
                        habit={h}
                        checked={dates.has(today)}
                        onToggle={() => void toggleHabitLog(h.id, today)}
                      />
                      {h.schedule.type === 'timesPerWeek' && (
                        <span className="rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold text-muted">
                          {weekDoneCount(dates, today)}/{h.schedule.times}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <div className="flex flex-col gap-3">
            {habits.map((h) => (
              <HabitCard
                key={h.id}
                habit={h}
                logs={logsByHabit.get(h.id) ?? []}
                onEdit={openEdit}
              />
            ))}
          </div>
        </div>
      )}
      <Fab
        onClick={() => {
          setEditing(null);
          setSheetOpen(true);
        }}
      />
      <HabitEditSheet open={sheetOpen} onClose={() => setSheetOpen(false)} habit={editing} />
    </Screen>
  );
}
