import { db, SCHEMA_VERSION } from './db';
import { now } from './repo';

const TABLES = [
  'projects',
  'tasks',
  'goals',
  'habits',
  'habitLogs',
  'notes',
  'learningItems',
  'learningLogs',
  'expenseItems',
  'energyItems',
  'placeItems',
  'metrics',
  'metricLogs',
  'reminderSections',
  'reminderItems',
  // Семейный контент (расшифрован локально): без него потеря устройства =
  // потеря всей истории чата. Конфиги семей (таблица family) НЕ включаем —
  // там ключ шифрования и токен, бэкап-файлу им не место.
  'familyMembers',
  'familyTasks',
  'familyMessages',
] as const;

type TableName = (typeof TABLES)[number];

export interface BackupFile {
  app: 'life-hub';
  schemaVersion: number;
  exportedAt: string;
  data: Record<TableName, unknown[]>;
}

export async function exportBackup(): Promise<BackupFile> {
  const data = {} as Record<TableName, unknown[]>;
  for (const name of TABLES) {
    // включая soft-deleted — бэкап должен быть полным
    data[name] = await db.table(name).toArray();
  }
  return { app: 'life-hub', schemaVersion: SCHEMA_VERSION, exportedAt: now(), data };
}

export function backupFilename(): string {
  return `life-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export interface ImportPreview {
  counts: Record<TableName, number>;
  exportedAt: string;
}

export function validateBackup(parsed: unknown): BackupFile {
  const b = parsed as BackupFile;
  if (!b || typeof b !== 'object' || b.app !== 'life-hub') {
    throw new Error('Это не файл резервной копии Life Hub');
  }
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) {
    throw new Error('Резервная копия создана более новой версией приложения');
  }
  if (!b.data || typeof b.data !== 'object') {
    throw new Error('Файл резервной копии повреждён: нет данных');
  }
  for (const name of TABLES) {
    if (b.data[name] !== undefined && !Array.isArray(b.data[name])) {
      throw new Error('Файл резервной копии повреждён: неверная структура данных');
    }
  }
  return b;
}

export function previewBackup(b: BackupFile): ImportPreview {
  const counts = {} as Record<TableName, number>;
  for (const name of TABLES) counts[name] = b.data[name]?.length ?? 0;
  return { counts, exportedAt: b.exportedAt };
}

/** Нормализует строку из старого бэкапа: проставляет поля, добавленные после
 *  той версии схемы. bulkPut пишет объекты вербатим и НЕ запускает Dexie
 *  upgrade-хуки (db.ts version(3).upgrade), поэтому бэкфилл нужен здесь —
 *  иначе у задач из бэкапа v3/v4 (schemaVersion 1/2) tags === undefined, и
 *  первый же рендер падает на task.tags (TaskItem, TasksPage). */
function normalizeRow(name: TableName, row: unknown): unknown {
  if (name === 'tasks') {
    const t = row as {
      tags?: unknown;
      checklist?: unknown;
      duration?: unknown;
      remindBefore?: unknown;
    };
    if (!Array.isArray(t.tags)) t.tags = [];
    if (!Array.isArray(t.checklist)) t.checklist = [];
    if (t.duration === undefined) t.duration = null;
    if (t.remindBefore === undefined) t.remindBefore = null;
  }
  return row;
}

/** Замена данных содержимым бэкапа, в одной транзакции. */
export async function importBackup(b: BackupFile): Promise<void> {
  const tables = TABLES.map((name) => db.table(name));
  await db.transaction('rw', tables, async () => {
    for (const name of TABLES) {
      const rows = b.data[name];
      // Таблицу, отсутствующую в файле, НЕ трогаем — иначе частичный или
      // старый бэкап молча затёр бы её текущие данные без возможности отката.
      if (rows === undefined) continue;
      const table = db.table(name);
      await table.clear();
      // bulkPut идемпотентен по первичному ключу id — переносит дубли id
      // из файла, не роняя всю транзакцию (в отличие от bulkAdd).
      if (rows.length) await table.bulkPut(rows.map((r) => normalizeRow(name, r)));
    }
  });
}
