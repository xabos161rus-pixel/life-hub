// Состояние семейного пространства: ключ, токен, курсор lastSeq. Отдельная
// Dexie-таблица family (изолирована от личного sync). НЕ синкается, НЕ в бэкап.

import { db } from '../../db/db';
import type { FamilyConfig } from '../../db/types';

export async function getFamilyConfig(): Promise<FamilyConfig | undefined> {
  return db.family.get('config');
}

export async function saveFamilyConfig(c: FamilyConfig): Promise<void> {
  await db.family.put(c);
}

export async function patchFamilyConfig(p: Partial<Omit<FamilyConfig, 'id'>>): Promise<void> {
  const cur = await getFamilyConfig();
  if (!cur) return;
  await db.family.put({ ...cur, ...p });
}

/** Выход из семьи: убираем конфиг и локальные семейные данные (на сервере остаются). */
export async function clearFamily(): Promise<void> {
  await db.transaction('rw', db.family, db.familyMembers, db.familyTasks, db.familyMessages, async () => {
    await db.family.delete('config');
    await db.familyMembers.clear();
    await db.familyTasks.clear();
    await db.familyMessages.clear();
  });
}

export async function isFamilyEnabled(): Promise<boolean> {
  const c = await getFamilyConfig();
  return !!c?.enabled;
}
