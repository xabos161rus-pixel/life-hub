// Жизненный цикл семейных групп: создать / войти по приглашению / код
// приглашения / выйти. Поддерживает несколько групп — create/join ДОБАВЛЯЮТ
// группу, не перезатирая существующие.

import {
  generateKey,
  exportKeyRaw,
  importKeyRaw,
  newAccountId,
  randomToken,
  decodeFamilyPairing,
  generateInviteWord,
  openInvite,
  peekInvite,
  sealInvite,
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
    updatedAt: new Date().toISOString(), // конфиг уедет на другие устройства аккаунта
  });
  await upsertSelfMember(familyId, displayName);
  connectFamily(familyId);
  return familyId;
}

/** Войти в существующую группу по коду приглашения (QR/строка). Если уже
 *  состоишь в этой группе — просто возвращаем её id (без дубля). */
export async function joinFamily(
  code: string,
  displayName: string,
  word?: string,
): Promise<string> {
  // Новый формат (v:3) требует кодового слова; старые коды (v:2) принимаем
  // как есть — люди могли сохранить приглашение до обновления, и ломать им
  // вход ради чистоты формата нельзя.
  const p = word !== undefined ? await openInvite(code, word) : decodeFamilyPairing(code);
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
    updatedAt: new Date().toISOString(), // конфиг уедет на другие устройства аккаунта
  });
  await upsertSelfMember(p.familyId, displayName);
  connectFamily(p.familyId);
  // Системное сообщение всем участникам: кто-то присоединился (уйдёт из outbox
  // при подключении; офлайн-участникам прилетит пушем как обычное сообщение).
  void sendSystemMessage(p.familyId, `${displayName.trim() || 'Участник'} присоединился`);
  return p.familyId;
}

/** Приглашение в группу: код плюс кодовое слово к нему.
 *
 *  Слово генерируется каждый раз новое и в приложении нигде не сохраняется:
 *  оно живёт ровно столько, сколько открыт экран приглашения. Приглашающий
 *  называет его отдельно от кода — голосом, при встрече, другим каналом.
 *  Смысл в том, что перехваченный код без слова бесполезен, а раньше он
 *  содержал ключ от всей переписки открытым текстом. */
export async function createFamilyInvite(
  familyId: string,
): Promise<{ code: string; word: string; expiresAt: string } | null> {
  const c = await getFamilyConfig(familyId);
  if (!c) return null;
  const word = generateInviteWord();
  const code = await sealInvite(
    {
      familyId: c.familyId,
      familyToken: c.familyToken,
      key: await exportKeyRaw(c.familyKey),
      familyName: c.familyName,
    },
    word,
  );
  return { code, word, expiresAt: peekInvite(code).expiresAt };
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
