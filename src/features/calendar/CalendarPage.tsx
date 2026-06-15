import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Task } from '../../db/types';
import { Screen } from '../../components/layout/Screen';
import { formatRu, todayKey, toKey, WEEKDAY_LABELS } from '../../lib/dates';
import { TaskItem } from '../tasks/TaskItem';
import { TaskEditSheet } from '../tasks/TaskEditSheet';

export function CalendarPage() {
  const tasksRaw = useLiveQuery(() => db.tasks.toArray(), []);
  const projectsRaw = useLiveQuery(() => db.projects.toArray(), []);

  const tasks = alive(tasksRaw ?? []);
  const projects = alive(projectsRaw ?? []).filter((p) => !p.archivedAt);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Месяц, отображаемый в сетке (ключ 'YYYY-MM-DD' любого дня этого месяца).
  const [monthKey, setMonthKey] = useState(() => todayKey());
  const [selectedDate, setSelectedDate] = useState(() => todayKey());

  const [editing, setEditing] = useState<Task | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const today = useMemo(() => todayKey(), []);

  // Сетка месяца с понедельника: от начала первой недели до конца последней.
  const grid = useMemo(() => {
    const monthDate = startOfMonth(new Date(`${monthKey.slice(0, 7)}-01T00:00:00`));
    const from = startOfWeek(monthDate, { weekStartsOn: 1 });
    const to = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
    return {
      monthDate,
      monthLabel: format(monthDate, 'LLLL yyyy', { locale: ru }),
      days: eachDayOfInterval({ start: from, end: to }).map((d) => ({
        date: d,
        key: toKey(d),
        inMonth: isSameMonth(d, monthDate),
      })),
    };
  }, [monthKey]);

  // Счётчик живых невыполненных задач по дню + флаг просрочки относительно сегодня.
  const dayStats = useMemo(() => {
    const map = new Map<string, { count: number; overdue: boolean }>();
    for (const t of tasks) {
      if (t.completedAt || !t.dueDate) continue;
      const prev = map.get(t.dueDate);
      const overdue = t.dueDate < today;
      if (prev) {
        prev.count += 1;
        prev.overdue = prev.overdue || overdue;
      } else {
        map.set(t.dueDate, { count: 1, overdue });
      }
    }
    return map;
  }, [tasks, today]);

  const dayTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.dueDate === selectedDate)
        .sort(
          (a, b) =>
            Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) ||
            (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
            b.priority - a.priority ||
            a.sortOrder - b.sortOrder,
        ),
    [tasks, selectedDate],
  );

  const monthLabel = grid.monthLabel.charAt(0).toUpperCase() + grid.monthLabel.slice(1);

  function shiftMonth(delta: number) {
    setMonthKey((cur) => toKey(addMonths(new Date(`${cur.slice(0, 7)}-01T00:00:00`), delta)));
  }

  function goToday() {
    const today = todayKey();
    setMonthKey(today);
    setSelectedDate(today);
  }

  function openTask(task: Task | null) {
    setEditing(task);
    setSheetOpen(true);
  }

  return (
    <Screen title="Календарь" backTo="/tasks">
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{monthLabel}</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToday}
              className="mr-1 rounded-lg px-2.5 py-1 text-sm font-medium text-accent active:opacity-60"
            >
              Сегодня
            </button>
            <button
              type="button"
              aria-label="Предыдущий месяц"
              onClick={() => shiftMonth(-1)}
              className="rounded-lg p-1.5 text-muted active:opacity-60"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              type="button"
              aria-label="Следующий месяц"
              onClick={() => shiftMonth(1)}
              className="rounded-lg p-1.5 text-muted active:opacity-60"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="pb-1 text-center text-xs font-medium text-muted">
              {label}
            </div>
          ))}
          {grid.days.map((day) => {
            const isToday = day.key === today;
            const isSelected = day.key === selectedDate;
            const stat = dayStats.get(day.key);
            return (
              <button
                key={day.key}
                type="button"
                onClick={() => setSelectedDate(day.key)}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition-colors ${
                  isSelected
                    ? 'bg-accent font-semibold text-white'
                    : day.inMonth
                      ? 'text-text active:bg-surface-2'
                      : 'text-muted/40'
                } ${isToday && !isSelected ? 'ring-1 ring-accent' : ''}`}
              >
                <span>{format(day.date, 'd')}</span>
                {stat && (
                  <span
                    className={`absolute bottom-1.5 size-1.5 rounded-full ${
                      isSelected
                        ? 'bg-white'
                        : stat.overdue
                          ? 'bg-danger'
                          : 'bg-accent'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-5">
        <h2 className="mb-2 px-1 text-sm font-semibold">Задачи на {formatRu(selectedDate)}</h2>
        {dayTasks.length > 0 ? (
          <div className="card divide-y divide-hairline px-4">
            {dayTasks.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                project={t.projectId ? (projectById.get(t.projectId) ?? null) : null}
                onEdit={openTask}
              />
            ))}
          </div>
        ) : (
          <p className="px-1 py-3 text-sm text-muted">На этот день задач нет</p>
        )}
        <button
          type="button"
          onClick={() => openTask(null)}
          className="mt-2 flex items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-accent active:opacity-60"
        >
          <Plus size={15} /> Задача на этот день
        </button>
      </section>

      <TaskEditSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        task={editing}
        defaults={{ dueDate: selectedDate }}
      />
    </Screen>
  );
}
