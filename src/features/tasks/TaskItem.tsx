import { useRef, useState, type PointerEvent } from 'react';
import { Repeat } from 'lucide-react';
import type { Project, Task } from '../../db/types';
import { TaskCheck } from '../../components/ui/Checkbox';
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

/** Строка задачи: чекбокс, заголовок, метаданные. Тап — редактирование,
 *  свайп влево — действия (Завтра/Удалить), свайп вправо — выполнить. */
export function TaskItem({
  task,
  project,
  onEdit,
}: {
  task: Task;
  project?: Project | null;
  onEdit?: (t: Task) => void;
}) {
  const toast = useToast();
  const done = Boolean(task.completedAt);
  const overdue = !done && task.dueDate !== null && task.dueDate < todayKey();
  const checklistDone = task.checklist.filter((i) => i.done).length;
  const hasMeta =
    Boolean(task.dueDate) || Boolean(task.recurrence) || Boolean(project) || task.checklist.length > 0;

  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ x: 0, dx: 0, moved: false });

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

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, dx, moved: false };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    const d = e.clientX - drag.current.x;
    if (Math.abs(d) > 6) drag.current.moved = true;
    setDx(Math.max(-ACTIONS_WIDTH, Math.min(ACTIONS_WIDTH, drag.current.dx + d)));
  };
  const onUp = () => {
    setDragging(false);
    setDx((cur) => {
      if (cur > SWIPE_THRESHOLD) {
        void handleToggle(); // свайп вправо — выполнить
        return 0;
      }
      return cur < -SWIPE_THRESHOLD ? -ACTIONS_WIDTH : 0;
    });
  };
  const onClick = () => {
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
        className="relative flex touch-pan-y items-center gap-3 bg-surface px-4 py-3"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform 0.2s',
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
          <p className={`truncate ${done ? 'text-muted line-through' : ''}`}>{task.title}</p>
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
                <span>
                  {checklistDone}/{task.checklist.length}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
