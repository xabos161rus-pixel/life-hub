import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarCheck } from 'lucide-react';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { TaskCheck } from '../../components/ui/Checkbox';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Habit, HabitLog } from '../../db/types';
import { todayKey } from '../../lib/dates';
import { doneDates, habitStats, scheduleLabel } from './habitStreak';
import { toggleHabitDone } from './habitRepo';
import { HabitSheet } from './HabitSheet';
import { HabitLogSheet } from './HabitLogSheet';

type Filter = 'active' | 'archived';

export function HabitsPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [logHabit, setLogHabit] = useState<Habit | null>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const today = todayKey();

  const habits = alive(useLiveQuery(() => db.habits.toArray(), []) ?? []);
  const logs = alive(useLiveQuery(() => db.habitLogs.toArray(), []) ?? []);

  // habitId → его логи (нужны и даты, и значения для количественных).
  const logsByHabit = useMemo(() => {
    const m = new Map<string, HabitLog[]>();
    for (const l of logs) {
      const arr = m.get(l.habitId);
      if (arr) arr.push(l);
      else m.set(l.habitId, [l]);
    }
    return m;
  }, [logs]);

  const activeHabits = habits.filter((h) => !h.archivedAt);
  const archivedHabits = habits.filter((h) => h.archivedAt);
  // Если архив опустел, а фильтр стоял на «Архив» — не застреваем на пустом
  // экране без переключателя: показываем активные.
  const effFilter: Filter =
    filter === 'archived' && archivedHabits.length === 0 ? 'active' : filter;
  const list = (effFilter === 'active' ? activeHabits : archivedHabits)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rows = list.map((habit) => {
    const hlogs = logsByHabit.get(habit.id) ?? [];
    const stats = habitStats(habit.schedule, doneDates(habit, hlogs), today);
    const todayValue = hlogs.find((l) => l.date === today)?.value ?? 0;
    return { habit, ...stats, todayValue };
  });

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (h: Habit) => {
    setEditing(h);
    setSheetOpen(true);
  };

  const logValue = logHabit
    ? (logsByHabit.get(logHabit.id)?.find((l) => l.date === today)?.value ?? 0)
    : 0;

  return (
    <Screen title="Привычки" backTo="/more">
      <div className="space-y-3">
        <div className="card p-4">
          <p className="text-sm leading-relaxed text-muted">
            Отмечайте выполнение каждый день — серия&nbsp;🔥 растёт, пока не пропустите
            запланированный день.
          </p>
        </div>

        {archivedHabits.length > 0 && (
          <SegmentedControl<Filter>
            options={[
              { value: 'active', label: `Активные (${activeHabits.length})` },
              { value: 'archived', label: `Архив (${archivedHabits.length})` },
            ]}
            value={effFilter}
            onChange={setFilter}
          />
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title={effFilter === 'archived' ? 'Архив пуст' : 'Пока нет привычек'}
            hint={
              effFilter === 'archived'
                ? 'Сюда попадают привычки, убранные в архив.'
                : 'Нажмите +, чтобы добавить привычку и вести серию.'
            }
          />
        ) : (
          rows.map(({ habit, current, best, doneToday, plannedToday, todayValue }) => {
            const counted = habit.target != null;
            const target = habit.target ?? 0;
            const pct = counted && target > 0 ? Math.min(100, (todayValue / target) * 100) : 0;
            return (
              <div
                key={habit.id}
                onClick={() => openEdit(habit)}
                className={`card flex items-center gap-3 p-4 active:opacity-90 ${
                  habit.archivedAt ? 'opacity-60' : ''
                }`}
              >
                <span className="text-2xl leading-none" aria-hidden>
                  {habit.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{habit.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {scheduleLabel(habit.schedule)}
                    {counted && ` · ${target}${habit.unit ? ' ' + habit.unit : ''}`}
                    {current > 0 && ` · 🔥 ${current}`}
                    {best > 1 && ` · рекорд ${best}`}
                  </p>
                </div>
                {habit.archivedAt ? null : !plannedToday ? (
                  <span className="shrink-0 text-[11px] text-muted">не сегодня</span>
                ) : counted ? (
                  <button
                    type="button"
                    aria-label="Ввести значение"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLogHabit(habit);
                    }}
                  >
                    <ProgressRing
                      value={pct}
                      size={44}
                      strokeWidth={4}
                      color={habit.color}
                      label={doneToday ? '✓' : `${todayValue}`}
                    />
                  </button>
                ) : (
                  <TaskCheck
                    checked={doneToday}
                    color={habit.color}
                    onChange={() => void toggleHabitDone(habit.id, today, !doneToday)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
      <Fab onClick={openCreate} />
      <HabitSheet open={sheetOpen} onClose={() => setSheetOpen(false)} item={editing} />
      <HabitLogSheet
        open={logHabit != null}
        onClose={() => setLogHabit(null)}
        habit={logHabit}
        date={today}
        currentValue={logValue}
      />
    </Screen>
  );
}
