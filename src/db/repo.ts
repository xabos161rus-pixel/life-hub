import type { Table, UpdateSpec } from 'dexie';
import type { BaseEntity } from './types';
import { scheduleSyncSoon } from '../lib/sync';

// Единственная точка записи в БД. UI-код не вызывает Dexie-методы записи
// напрямую — это гарантирует sync-ready штампы (id/updatedAt/deletedAt)
// и единый триггер мгновенной синхронизации после правок. (Применение
// входящих записей при pull идёт мимо repo — напрямую в Dexie — поэтому
// синк не зацикливается.)

export function now(): string {
  return new Date().toISOString();
}

export function uid(): string {
  return crypto.randomUUID();
}

export async function create<T extends BaseEntity>(
  table: Table<T, string>,
  data: Omit<T, keyof BaseEntity>,
): Promise<T> {
  const ts = now();
  const entity = {
    ...data,
    id: uid(),
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  } as T;
  await table.add(entity);
  scheduleSyncSoon();
  return entity;
}

export async function update<T extends BaseEntity>(
  table: Table<T, string>,
  id: string,
  changes: Partial<Omit<T, 'id' | 'createdAt'>>,
): Promise<void> {
  await table.update(id, { ...changes, updatedAt: now() } as UpdateSpec<T>);
  scheduleSyncSoon();
}

/** Мягкое удаление: запись скрывается из UI, но остаётся для будущего синка. */
export async function remove<T extends BaseEntity>(
  table: Table<T, string>,
  id: string,
): Promise<void> {
  await table.update(id, { deletedAt: now(), updatedAt: now() } as unknown as UpdateSpec<T>);
  scheduleSyncSoon();
}

/** Фильтр живых записей — применять после каждого чтения списком. */
export function alive<T extends BaseEntity>(rows: T[]): T[] {
  return rows.filter((r) => !r.deletedAt);
}
