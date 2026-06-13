import { Repeat } from 'lucide-react';
import type { Project, Task } from '../../db/types';
import { TaskCheck } from '../../components/ui/Checkbox';
import { useToast } from '../../components/ui/Toast';
import { formatDueDate, todayKey } from '../../lib/dates';
import { describeRecurrence } from '../../lib/recurrence';
import { toggleTask } from './taskActions';

const PRIORITY_BAR: Record<number, string> = {
  3: 'bg-danger',
  2: 'bg-warning',
  1: 'bg-muted',
  0: 'bg-transparent',
};

/** Строка задачи: чекбокс, заголовок, метаданные. Тап по строке — редактирование. */
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

  const handleToggle = async () => {
    const next = await toggleTask(task);
    if (next) toast(`Повторится ${formatDueDate(next)}`);
  };

  return (
    <div className="flex items-center gap-3 py-3" onClick={() => onEdit?.(task)}>
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
  );
}
