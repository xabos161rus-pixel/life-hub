import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck } from 'lucide-react';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { TaskCheck } from '../../components/ui/Checkbox';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Habit } from '../../db/types';
import { todayKey } from '../../lib/dates';
import { habitStats, scheduleLabel } from './habitStreak';
import { setHabitDay } from './habitRepo';
import { HabitSheet } from './HabitSheet';

export function HabitsPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const today = todayKey();

  const habits = alive(useLiveQuery(() => db.habits.toArray(), []) ?? []).filter(
    (h) => !h.archivedAt,
  );
  const logs = alive(useLiveQuery(() => db.habitLogs.toArray(), []) ?? []);

  // habitId → множество дат-отметок (для подсчёта серий).
  const doneByHabit = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of logs) {
      let s = m.get(l.habitId);
      if (!s) {
        s = new Set();
        m.set(l.habitId, s);
      }
      s.add(l.date);
    }
    return m;
  }, [logs]);

  const rows = habits
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((habit) => ({
      habit,
      ...habitStats(habit.schedule, doneByHabit.get(habit.id) ?? new Set(), today),
    }));

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (h: Habit) => {
    setEditing(h);
    setSheetOpen(true);
  };

  return (
    <Screen title="Привычки" backTo="/more">
      <div className="space-y-3">
        <div className="card p-4">
          <p className="text-sm leading-relaxed text-muted">
            Отмечайте выполнение каждый день — серия&nbsp;🔥 растёт, пока не пропустите
            запланированный день.
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Пока нет привычек"
            hint="Нажмите +, чтобы добавить привычку и вести серию."
          />
        ) : (
          rows.map(({ habit, current, best, doneToday, plannedToday }) => (
            <div
              key={habit.id}
              onClick={() => openEdit(habit)}
              className="card flex items-center gap-3 p-4 active:opacity-90"
            >
              <span className="text-2xl leading-none" aria-hidden>
                {habit.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{habit.name}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {scheduleLabel(habit.schedule)}
                  {current > 0 && ` · 🔥 ${current}`}
                  {best > 1 && ` · рекорд ${best}`}
                </p>
              </div>
              {plannedToday ? (
                <TaskCheck
                  checked={doneToday}
                  color={habit.color}
                  onChange={() => void setHabitDay(habit.id, today, !doneToday)}
                />
              ) : (
                <span className="shrink-0 text-[11px] text-muted">не сегодня</span>
              )}
            </div>
          ))
        )}
      </div>
      <Fab onClick={openCreate} />
      <HabitSheet open={sheetOpen} onClose={() => setSheetOpen(false)} item={editing} />
    </Screen>
  );
}
