// Состояние семейных пространств: ключ, токен, курсор lastSeq — по одной
// строке на группу (первичный ключ = familyId). Отдельная Dexie-таблица family
// (изолирована от личного sync). НЕ синкается, НЕ в бэкап.

import { db } from '../../db/db';
import type { FamilyConfig } from '../../db/types';

export async function getFamilyConfig(familyId: string): Promise<FamilyConfig | undefined> {
  return db.family.get(familyId);
}

/** Все семейные группы пользователя (по joinedAt — старые сверху). */
export async function listFamilyConfigs(): Promise<FamilyConfig[]> {
  const all = await db.family.toArray();
  return all.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

export async function saveFamilyConfig(c: FamilyConfig): Promise<void> {
  await db.family.put(c);
}

export async function patchFamilyConfig(familyId: string, p: Partial<Omit<FamilyConfig, 'id' | 'familyId'>>): Promise<void> {
  const cur = await getFamilyConfig(familyId);
  if (!cur) return;
  await db.family.put({ ...cur, ...p });
}

/** Выход из одной группы: убираем её конфиг и её локальные данные (на
 *  сервере остаются). Другие группы не трогаем. */
export async function clearFamily(familyId: string): Promise<void> {
  await db.transaction('rw', db.family, db.familyMembers, db.familyTasks, db.familyMessages, async () => {
    await db.family.delete(familyId);
    await db.familyMembers.where('familyId').equals(familyId).delete();
    await db.familyTasks.where('familyId').equals(familyId).delete();
    await db.familyMessages.where('familyId').equals(familyId).delete();
  });
}

/** Есть ли хотя бы одна включённая группа. */
export async function hasAnyFamily(): Promise<boolean> {
  const all = await db.family.toArray();
  return all.some((c) => c.enabled);
}
