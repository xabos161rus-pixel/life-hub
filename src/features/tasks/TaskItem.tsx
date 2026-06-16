import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { Copy, Repeat } from 'lucide-react';
import type { Project, Task } from '../../db/types';
import { TaskCheck } from '../../components/ui/Checkbox';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { useToast } from '../../components/ui/Toast';
import { db } from '../../db/db';
import { remove, update } from '../../db/repo';
import { addDaysKey, formatDueDate, todayKey } from '../../lib/dates';
import { describeRecurrence } from '../../lib/recurrence';
import { toggleTask } from './taskActions';

const PRIORITY_BAR: Record<number, string> = {
  3: 'bg-danger',
  2: 'bg-warning',
  1: 'bg-muted',
  0: 'bg-transparent',
};

const ACTIONS_WIDTH = 152; // ширина блока действий слева (две кнопки)
const SWIPE_THRESHOLD = 40; // меньше — считается тапом
const LONG_PRESS_MS = 400; // удержание без движения → старт drag-режима
const DRAG_CANCEL_MOVE = 8; // горизонт/вертикаль сдвиг, отменяющий long-press

/** Строка задачи: чекбокс, заголовок, метаданные. Тап — редактирование,
 *  свайп влево — действия (Завтра/Удалить), свайп вправо — выполнить.
 *  Удержание ~400мс без движения (когда передан onDragStart) — старт
 *  drag-режима переноса между проектами (логику переноса ведёт TasksPage). */
export function TaskItem({
  task,
  project,
  onEdit,
  onDragStart,
  isDragSource = false,
}: {
  task: Task;
  project?: Project | null;
  onEdit?: (t: Task) => void;
  /** Опциональный: вызывается при long-press со стартовыми координатами пальца.
   *  Места без него (Today/Calendar/GoalDetail) просто не получают drag. */
  onDragStart?: (t: Task, at: { x: number; y: number }) => void;
  /** Управляемый родителем визуальный сигнал «эта задача сейчас тащится». */
  isDragSource?: boolean;
}) {
  const toast = useToast();
  const done = Boolean(task.completedAt);
  // Где включён drag — глушим нативное выделение/лупу/callout iOS, иначе
  // удержание шлёт строке pointercancel и перенос срывается.
  const draggable = Boolean(onDragStart);
  const overdue = !done && task.dueDate !== null && task.dueDate < todayKey();
  const checklistDone = task.checklist.filter((i) => i.done).length;
  const checklistPct = task.checklist.length
    ? (checklistDone / task.checklist.length) * 100
    : 0;
  const hasMeta =
    Boolean(task.dueDate) ||
    Boolean(task.recurrence) ||
    Boolean(project) ||
    task.checklist.length > 0 ||
    task.tags.length > 0;

  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // moved — был ли горизонтальный свайп; longPressed — сработал ли long-press
  // (тогда дальнейшие move/up в этой строке игнорируются: жест ведёт TasksPage).
  const drag = useRef({ x: 0, y: 0, dx: 0, moved: false, longPressed: false });
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearLongPress = () => {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
  };

  // Подстраховка: снять висящий таймер при размонтировании строки.
  useEffect(() => clearLongPress, []);

  const handleToggle = async () => {
    setDx(0);
    const next = await toggleTask(task);
    if (next) toast(`Повторится ${formatDueDate(next)}`);
  };

  const handleTomorrow = () => {
    setDx(0);
    void update(db.tasks, task.id, { dueDate: addDaysKey(todayKey(), 1) });
    toast('Перенесено на завтра');
  };

  const handleDelete = () => {
    if (window.confirm('Удалить задачу?')) void remove(db.tasks, task.id);
    else setDx(0);
  };

  const handleCopy = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const text = task.title + (task.notes ? `\n\n${task.notes}` : '');
    void navigator.clipboard.writeText(text);
    toast('Скопировано');
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, dx, moved: false, longPressed: false };
    setDragging(true);
    // Long-press → drag-режим. Армируем только там, где перенос поддержан.
    if (onDragStart) {
      clearLongPress();
      longPressTimer.current = setTimeout(() => {
        drag.current.longPressed = true;
        setDragging(false); // прекращаем визуальный свайп: жест ушёл в drag
        setDx(0);
        onDragStart(task, { x: drag.current.x, y: drag.current.y });
      }, LONG_PRESS_MS);
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current.longPressed) return; // жест ведёт TasksPage
    if (e.buttons === 0) return;
    const d = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    // Любое заметное движение (по X — свайп, по Y — скролл) отменяет long-press.
    if (Math.abs(d) > DRAG_CANCEL_MOVE || Math.abs(dy) > DRAG_CANCEL_MOVE) {
      clearLongPress();
    }
    if (Math.abs(d) > 6) drag.current.moved = true;
    setDx(Math.max(-ACTIONS_WIDTH, Math.min(ACTIONS_WIDTH, drag.current.dx + d)));
  };
  const onUp = () => {
    clearLongPress();
    if (drag.current.longPressed) return; // перенос завершит TasksPage
    setDragging(false);
    // Решение принимаем снаружи setState-апдейтера: побочный эффект внутри
    // апдейтера в StrictMode вызывался бы дважды → дубль toggleTask.
    if (dx > SWIPE_THRESHOLD) {
      void handleToggle(); // свайп вправо — выполнить (handleToggle сам сбросит dx)
    } else if (dx < -SWIPE_THRESHOLD) {
      setDx(-ACTIONS_WIDTH);
    } else {
      setDx(0);
    }
  };
  const onClick = () => {
    if (drag.current.longPressed) return; // это был старт переноса, не тап
    if (drag.current.moved) return; // это был свайп, не тап
    if (dx !== 0) {
      setDx(0); // открыты действия — закрываем
      return;
    }
    onEdit?.(task);
  };

  return (
    <div className="relative -mx-4 overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          onClick={handleTomorrow}
          className="flex w-[76px] items-center justify-center bg-surface-2 text-sm font-medium text-accent"
        >
          Завтра
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="flex w-[76px] items-center justify-center bg-danger text-sm font-medium text-white"
        >
          Удалить
        </button>
      </div>
      <div
        className={`relative flex touch-pan-y items-start gap-3 bg-surface px-4 py-3 ${
          draggable ? 'select-none [-webkit-user-select:none] [-webkit-touch-callout:none]' : ''
        } ${isDragSource ? 'scale-[0.97] opacity-40' : ''}`}
        style={{
          transform: isDragSource ? undefined : `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 0.2s, opacity 0.15s',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={onClick}
      >
        <span className={`w-1 shrink-0 self-stretch rounded-full ${PRIORITY_BAR[task.priority]}`} />
        <TaskCheck checked={done} onChange={handleToggle} color={project?.color} />
        <div className="min-w-0 flex-1">
          <p className={`break-words ${done ? 'text-muted line-through' : ''}`}>{task.title}</p>
          {hasMeta && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              {task.dueDate && (
                <span className={overdue ? 'text-danger' : ''}>
                  {formatDueDate(task.dueDate)}
                  {task.dueTime ? `, ${task.dueTime}` : ''}
                </span>
              )}
              {task.recurrence && (
                <span className="flex items-center gap-0.5">
                  <Repeat size={11} />
                  {describeRecurrence(task.recurrence)}
                </span>
              )}
              {project && (
                <span className="truncate">
                  {project.emoji} {project.name}
                </span>
              )}
              {task.checklist.length > 0 && (
                <span className="flex items-center gap-1.5">
                  {checklistDone}/{task.checklist.length}
                  <span className="w-16">
                    <ProgressBar
                      value={checklistPct}
                      color={
                        checklistDone === task.checklist.length
                          ? 'var(--app-success)'
                          : undefined
                      }
                    />
                  </span>
                </span>
              )}
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted"
                >
                  #{tag}
                </span>
              ))}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Скопировать задачу"
          onClick={handleCopy}
          className="-mr-1 mt-0.5 shrink-0 p-1 text-muted active:opacity-60"
        >
          <Copy size={15} />
        </button>
      </div>
    </div>
  );
}
