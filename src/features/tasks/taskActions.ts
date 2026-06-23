import type { Task } from '../../db/types';
import { db } from '../../db/db';
import { create, now, uid, update } from '../../db/repo';
import { nextOccurrence } from '../../lib/recurrence';
import { todayKey } from '../../lib/dates';
import { cancelReminder, scheduleReminder } from '../../lib/push';

/**
 * Переключение выполненности задачи.
 * Для повторяющейся задачи при выполнении создаётся следующее повторение.
 * Возвращает dueDate нового повторения (для тоста «Повторится …») или null.
 */
export async function toggleTask(task: Task): Promise<string | null> {
  if (task.completedAt) {
    await update(db.tasks, task.id, { completedAt: null });
    void scheduleReminder(task); // снова активна — вернуть напоминание
    return null;
  }

  await update(db.tasks, task.id, { completedAt: now() });
  void cancelReminder(task.id); // выполнена — напоминание не нужно

  if (task.recurrence) {
    const nextDue = nextOccurrence(task.recurrence, task.dueDate);
    const next = await create(db.tasks, {
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
    void scheduleReminder(next); // напоминание для следующего повторения
    return nextDue;
  }

  return null;
}

/**
 * Отметить задачу «пропущена» (не выполнена): фиксируем пропуск для статистики
 * и возвращаем задачу в штатный режим — повторяющаяся переходит к следующему
 * повтору, разовая переносится на сегодня (перестаёт быть просроченной).
 */
export async function skipTask(task: Task): Promise<void> {
  if (task.completedAt) return;
  const skippedCount = (task.skippedCount ?? 0) + 1;
  const nextDue = task.recurrence ? nextOccurrence(task.recurrence, task.dueDate) : todayKey();
  await update(db.tasks, task.id, { dueDate: nextDue, skippedCount });
  void scheduleReminder({ ...task, dueDate: nextDue });
}
