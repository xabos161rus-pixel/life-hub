import type { Task } from '../../db/types';
import { db } from '../../db/db';
import { create, now, uid, update } from '../../db/repo';
import { nextOccurrence } from '../../lib/recurrence';

/**
 * Переключение выполненности задачи.
 * Для повторяющейся задачи при выполнении создаётся следующее повторение.
 * Возвращает dueDate нового повторения (для тоста «Повторится …») или null.
 */
export async function toggleTask(task: Task): Promise<string | null> {
  if (task.completedAt) {
    await update(db.tasks, task.id, { completedAt: null });
    return null;
  }

  await update(db.tasks, task.id, { completedAt: now() });

  if (task.recurrence) {
    const nextDue = nextOccurrence(task.recurrence, task.dueDate);
    await create(db.tasks, {
      title: task.title,
      notes: task.notes,
      projectId: task.projectId,
      // goalId НЕ переносим: иначе каждое выполнение повторяющейся задачи
      // плодило бы новую запись в прогрессе цели (знаменатель рос бы безгранично).
      goalId: null,
      priority: task.priority,
      dueDate: nextDue,
      dueTime: task.dueTime ?? null,
      duration: task.duration ?? null,
      remindBefore: task.remindBefore ?? null,
      completedAt: null,
      checklist: task.checklist.map((i) => ({ id: uid(), text: i.text, done: false })),
      recurrence: task.recurrence,
      tags: [...task.tags],
      sortOrder: task.sortOrder,
    });
    return nextDue;
  }

  return null;
}
