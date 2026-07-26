// Запись семейных сущностей (задачи, участники) в конкретную группу. Пишет
// локально (seq=0 — «ещё без серверного seq»), затем отправляет на DO через
// familyChat. НЕ использует личный repo/scheduleSyncSoon — у семьи свой транспорт.

import { db } from '../../db/db';
import type { FamilyTask, FamilyMember, Priority } from '../../db/types';
import { PRESET_COLORS } from '../colors';
import { getFamilyConfig } from './familyState';
import { sendItem } from './familyChat';

function stripMeta<T extends { id: string; seq: number; familyId: string; pendingNotify?: unknown }>(
  row: T,
): Omit<T, 'id' | 'seq' | 'familyId' | 'pendingNotify'> {
  const { id, seq, familyId, pendingNotify, ...rest } = row;
  void id;
  void seq;
  void familyId;
  void pendingNotify; // локальный флаг доставки, чужим устройствам он не нужен
  return rest;
}

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PRESET_COLORS[h % PRESET_COLORS.length];
}

export async function upsertSelfMember(familyId: string, displayName: string): Promise<void> {
  const c = await getFamilyConfig(familyId);
  if (!c) return;
  const existing = await db.familyMembers.get(c.selfMemberId);
  const member: FamilyMember = {
    id: c.selfMemberId,
    familyId,
    seq: 0,
    displayName: displayName.trim() || 'Без имени',
    color: existing?.color ?? colorFor(c.selfMemberId),
    joinedAt: existing?.joinedAt ?? c.joinedAt,
    leftAt: null,
    // Публичный ключ едет вместе с именем: остальным он нужен, чтобы при
    // исключении кого-то третьего суметь передать нам новый ключ группы.
    boxPub: c.boxPub ?? existing?.boxPub,
    removedAt: existing?.removedAt ?? null,
  };
  await db.familyMembers.put(member);
  await sendItem(familyId, 'member', member.id, stripMeta(member));
}

export async function createFamilyTask(
  familyId: string,
  data: {
    title: string;
    notes?: string;
    priority?: Priority;
    dueDate?: string | null;
    assigneeId?: string | null;
  },
): Promise<void> {
  const c = await getFamilyConfig(familyId);
  if (!c) return;
  const task: FamilyTask = {
    id: crypto.randomUUID(),
    familyId,
    seq: 0,
    title: data.title.trim(),
    notes: data.notes ?? '',
    priority: data.priority ?? 0,
    dueDate: data.dueDate ?? null,
    assigneeId: data.assigneeId ?? null,
    createdBy: c.selfMemberId,
    completedAt: null,
    completedBy: null,
    sortOrder: Date.now(),
    deletedAt: null,
  };
  await db.familyTasks.put(task);
  await sendItem(familyId, 'task', task.id, stripMeta(task));
}

export async function updateFamilyTask(
  familyId: string,
  id: string,
  changes: Partial<FamilyTask>,
  notify?: 'done',
): Promise<void> {
  const local = await db.familyTasks.get(id);
  if (!local) return;
  const next: FamilyTask = { ...local, ...changes, id, familyId, seq: 0 }; // seq=0 → неподтверждённая правка
  await db.familyTasks.put(next);
  const sent = await sendItem(familyId, 'task', id, stripMeta(next), notify);
  // Помечаем повтор, только если кадр не ушёл. Снятие галочки гасит флаг: иначе
  // отложенный пуш объявит выполненной задачу, с которой отметку уже сняли.
  let pending: 'done' | undefined;
  if (!sent && changes.completedAt !== null) pending = notify ?? local.pendingNotify;
  if (pending !== local.pendingNotify) await db.familyTasks.update(id, { pendingNotify: pending });
}

export async function toggleFamilyTask(familyId: string, task: FamilyTask): Promise<void> {
  const c = await getFamilyConfig(familyId);
  if (!c) return;
  const done = !task.completedAt;
  await updateFamilyTask(
    familyId,
    task.id,
    done
      ? { completedAt: new Date().toISOString(), completedBy: c.selfMemberId }
      : { completedAt: null, completedBy: null },
    // Пуш только на «выполнена». Снятие галочки — не событие для остальных.
    done ? 'done' : undefined,
  );
}

export async function deleteFamilyTask(familyId: string, id: string): Promise<void> {
  await updateFamilyTask(familyId, id, { deletedAt: new Date().toISOString() });
}
