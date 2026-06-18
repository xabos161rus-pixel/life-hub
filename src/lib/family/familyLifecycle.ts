// Жизненный цикл семьи: создать / войти по приглашению / код приглашения / выйти.

import {
  generateKey,
  exportKeyRaw,
  importKeyRaw,
  newAccountId,
  randomToken,
  encodeFamilyPairing,
  decodeFamilyPairing,
} from '../crypto';
import { saveFamilyConfig, getFamilyConfig, clearFamily } from './familyState';
import { upsertSelfMember } from './familyRepo';
import { connect, disconnect } from './familyChat';

/** Создать новую семью на этом устройстве (ты — первый участник). */
export async function createFamily(familyName: string, displayName: string): Promise<void> {
  const key = await generateKey();
  await saveFamilyConfig({
    id: 'config',
    familyId: newAccountId(),
    familyToken: randomToken(),
    familyKey: key,
    familyName: familyName.trim() || 'Семья',
    selfMemberId: newAccountId(),
    lastSeq: 0,
    enabled: true,
    joinedAt: new Date().toISOString(),
  });
  await upsertSelfMember(displayName);
  await connect();
}

/** Войти в существующую семью по коду приглашения (QR/строка). */
export async function joinFamily(code: string, displayName: string): Promise<void> {
  const p = decodeFamilyPairing(code);
  const key = await importKeyRaw(p.key);
  await saveFamilyConfig({
    id: 'config',
    familyId: p.familyId,
    familyToken: p.familyToken,
    familyKey: key,
    familyName: p.familyName,
    selfMemberId: newAccountId(),
    lastSeq: 0,
    enabled: true,
    joinedAt: new Date().toISOString(),
  });
  await upsertSelfMember(displayName);
  await connect();
}

/** Код приглашения для другого члена семьи (QR / резервная копия). */
export async function getFamilyInviteCode(): Promise<string | null> {
  const c = await getFamilyConfig();
  if (!c) return null;
  return encodeFamilyPairing({
    v: 2,
    familyId: c.familyId,
    familyToken: c.familyToken,
    key: await exportKeyRaw(c.familyKey),
    familyName: c.familyName,
  });
}

/** Выйти из семьи на этом устройстве (локальные семейные данные стираются). */
export async function leaveFamily(): Promise<void> {
  disconnect();
  await clearFamily();
}
