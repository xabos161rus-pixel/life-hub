// Жизненный цикл семейных групп: создать / войти по приглашению / код
// приглашения / выйти. Поддерживает несколько групп — create/join ДОБАВЛЯЮТ
// группу, не перезатирая существующие.

import {
  generateKey,
  exportKeyRaw,
  importKeyRaw,
  newAccountId,
  randomToken,
  encodeFamilyPairing,
  decodeFamilyPairing,
} from '../crypto';
import { saveFamilyConfig, getFamilyConfig, listFamilyConfigs, clearFamily } from './familyState';
import { upsertSelfMember } from './familyRepo';
import { connectFamily, disconnectFamily, sendSystemMessage } from './familyChat';

/** Создать новую группу на этом устройстве (ты — первый участник). Возвращает
 *  familyId созданной группы (чтобы UI сразу её выбрал). */
export async function createFamily(familyName: string, displayName: string): Promise<string> {
  const key = await generateKey();
  const familyId = newAccountId();
  await saveFamilyConfig({
    id: familyId,
    familyId,
    familyToken: randomToken(),
    familyKey: key,
    familyName: familyName.trim() || 'Семья',
    selfMemberId: newAccountId(),
    lastSeq: 0,
    lastReadSeq: 0,
    enabled: true,
    joinedAt: new Date().toISOString(),
  });
  await upsertSelfMember(familyId, displayName);
  connectFamily(familyId);
  return familyId;
}

/** Войти в существующую группу по коду приглашения (QR/строка). Если уже
 *  состоишь в этой группе — просто возвращаем её id (без дубля). */
export async function joinFamily(code: string, displayName: string): Promise<string> {
  const p = decodeFamilyPairing(code);
  const existing = await getFamilyConfig(p.familyId);
  if (existing) {
    connectFamily(p.familyId);
    return p.familyId;
  }
  const key = await importKeyRaw(p.key);
  await saveFamilyConfig({
    id: p.familyId,
    familyId: p.familyId,
    familyToken: p.familyToken,
    familyKey: key,
    familyName: p.familyName,
    selfMemberId: newAccountId(),
    lastSeq: 0,
    lastReadSeq: 0,
    enabled: true,
    joinedAt: new Date().toISOString(),
  });
  await upsertSelfMember(p.familyId, displayName);
  connectFamily(p.familyId);
  // Системное сообщение всем участникам: кто-то присоединился (уйдёт из outbox
  // при подключении; офлайн-участникам прилетит пушем как обычное сообщение).
  void sendSystemMessage(p.familyId, `${displayName.trim() || 'Участник'} присоединился`);
  return p.familyId;
}

/** Код приглашения для другого члена группы (QR / резервная копия). */
export async function getFamilyInviteCode(familyId: string): Promise<string | null> {
  const c = await getFamilyConfig(familyId);
  if (!c) return null;
  return encodeFamilyPairing({
    v: 2,
    familyId: c.familyId,
    familyToken: c.familyToken,
    key: await exportKeyRaw(c.familyKey),
    familyName: c.familyName,
  });
}

/** Выйти из группы на этом устройстве (её локальные данные стираются). */
export async function leaveFamily(familyId: string): Promise<void> {
  disconnectFamily(familyId);
  await clearFamily(familyId);
}

/** familyId группы, которую показать по умолчанию (первая по joinedAt). */
export async function firstFamilyId(): Promise<string | null> {
  const all = await listFamilyConfigs();
  return all[0]?.familyId ?? null;
}
