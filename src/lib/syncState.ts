// Состояние E2E-синхронизации: ключ, токены доступа и курсоры дельта-синка.
// Хранится в Dexie-таблице `sync` (строка id='config'), НЕ синкается и НЕ
// входит в бэкап. CryptoKey лежит non-extractable — XSS не сможет его выгрузить.

import { db } from '../db/db';
import type { SyncConfig } from '../db/types';

export async function getSyncConfig(): Promise<SyncConfig | undefined> {
  return db.sync.get('config');
}

export async function saveSyncConfig(c: SyncConfig): Promise<void> {
  await db.sync.put(c);
}

export async function patchSyncConfig(p: Partial<Omit<SyncConfig, 'id'>>): Promise<void> {
  const cur = await getSyncConfig();
  if (!cur) return;
  await db.sync.put({ ...cur, ...p });
}

export async function clearSyncConfig(): Promise<void> {
  await db.sync.delete('config');
}

export async function isSyncEnabled(): Promise<boolean> {
  const c = await getSyncConfig();
  return !!c?.enabled;
}
