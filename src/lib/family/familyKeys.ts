// Ключи группы и исключение участников.
//
// Задача, ради которой всё это существует: убрать человека из семейной группы
// так, чтобы он перестал читать переписку. Одной кнопки на сервере мало —
// сервер нам не доверенное лицо, и «он больше не подключится» ничего не значит,
// если ключ от шифротекста у него на руках. Значит после исключения группа
// должна перейти на НОВЫЙ ключ, а исключённый не должен его получить.
//
// Раздать новый ключ общим каналом нельзя: исключённый ещё в группе и прочитает
// рассылку старым ключом. Поэтому каждому оставшемуся кладётся личный конверт,
// зашифрованный на его публичный ключ (ECDH). Исключённому конверт не кладётся
// вовсе, а если старый лежал — сервер его удаляет.
//
// Три вещи, которые эта схема НЕ даёт, и о них честно в docs/family-chat-security.md:
//  — прошлую переписку исключённый читает: у него остался старый ключ и, если
//    он сохранил копию сообщений, они при нём. Отобрать скачанное невозможно;
//  — участник без публичного ключа (не обновил приложение) нового ключа не
//    получит и выпадет из группы вместе с исключённым — поэтому перед
//    исключением о таких предупреждаем;
//  — владельца исключить нельзя, и если он потерял устройство вместе с
//    секретом — исключать больше некому.

import { db } from '../../db/db';
import type { FamilyConfig, FamilyMember } from '../../db/types';
import {
  decryptJSON,
  encryptJSON,
  exportBoxPrivate,
  exportBoxPublic,
  exportKeyRaw,
  generateBoxKeyPair,
  generateKey,
  importBoxPrivate,
  importBoxPublic,
  importKeyRaw,
  openFrom,
  packEpoch,
  randomToken,
  sealFor,
  sha256hex,
  unpackEpoch,
} from '../crypto';
import { getFamilyConfig, patchFamilyConfig } from './familyState';

export const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';

/** Содержимое личного конверта: новый ключ группы и новый токен доступа. */
interface SealedKeyPayload {
  epoch: number;
  keyRaw: string;
  familyToken: string;
}

// === Эпохи: шифруем текущей, читаем любой известной ===

function epochOf(c: FamilyConfig): number {
  return c.keyEpoch ?? 0;
}

function keyForEpoch(c: FamilyConfig, epoch: number): CryptoKey | undefined {
  if (epoch === epochOf(c)) return c.familyKey;
  return c.keyRing?.[String(epoch)];
}

/** Зашифровать текущей эпохой и пометить её в шифротексте. */
export async function encFamily(c: FamilyConfig, obj: unknown): Promise<string> {
  return packEpoch(epochOf(c), await encryptJSON(c.familyKey, obj));
}

/** Расшифровать тем ключом, которым это было зашифровано. Ключа нет — бросаем:
 *  вызывающий уже умеет молча пропускать нечитаемое. */
export async function decFamily<T>(c: FamilyConfig, raw: string): Promise<T> {
  const { epoch, payload } = unpackEpoch(raw);
  const key = keyForEpoch(c, epoch);
  if (!key) throw new Error(`нет ключа эпохи ${epoch}`);
  return decryptJSON<T>(key, payload);
}

// === Личная пара участника ===

/** Завести пару для адресных конвертов, если её ещё нет. Возвращает конфиг с
 *  ключами — вызывающему они нужны сразу. */
export async function ensureBoxKeys(c: FamilyConfig): Promise<FamilyConfig> {
  if (c.boxPub && c.boxPriv) return c;
  const pair = await generateBoxKeyPair();
  const boxPub = await exportBoxPublic(pair.publicKey);
  const boxPriv = await exportBoxPrivate(pair.privateKey);
  await patchFamilyConfig(c.familyId, { boxPub, boxPriv });
  return { ...c, boxPub, boxPriv };
}

/** Зарегистрировать участника на сервере: публичный ключ и — для создателя
 *  группы — заявка на владение. Возвращает memberId владельца.
 *
 *  Вызывается при каждом подключении, не только при входе: у тех, кто вошёл в
 *  группу до появления этого механизма, ключа на сервере нет, а без него их
 *  нельзя ни оставить в группе при смене ключа, ни защитить от чужого. */
export async function registerMember(familyId: string): Promise<string | null> {
  let c = await getFamilyConfig(familyId);
  if (!c) return null;
  c = await ensureBoxKeys(c);
  try {
    const res = await fetch(`${WORKER_URL}/family/register?familyId=${c.familyId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.familyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: c.selfMemberId,
        boxPub: c.boxPub,
        // Хеш, не сам секрет: сервер должен уметь проверить владельца, но не
        // должен уметь им притвориться.
        ...(c.ownerSecret ? { ownerSecretHash: await sha256hex(c.ownerSecret) } : {}),
      }),
    });
    if (!res.ok) return null;
    const { owner } = (await res.json()) as { owner: string | null };
    // Владелец закрепляется единожды: подмена сервером после первой регистрации
    // не пройдёт — иначе он назначил бы владельцем сообщника.
    if (owner && !c.ownerMemberId) await patchFamilyConfig(familyId, { ownerMemberId: owner });
    return owner;
  } catch {
    return null; // нет сети — попробуем на следующем подключении
  }
}

/** Разослать свой публичный ключ остальным через канал 'member'. */
export async function publishBoxPub(familyId: string): Promise<void> {
  const c = await getFamilyConfig(familyId);
  if (!c?.boxPub) return;
  const mem = await db.familyMembers.get(c.selfMemberId);
  if (!mem || mem.boxPub === c.boxPub) return;
  await db.familyMembers.put({ ...mem, boxPub: c.boxPub, seq: 0 });
}

// === Приём нового ключа ===

/** Забрать свой конверт с сервера. Без авторизации: после смены ключа старый
 *  токен уже не подходит, а новый — как раз внутри конверта. */
async function fetchSealedKey(familyId: string, memberId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${WORKER_URL}/family/keys?familyId=${familyId}&member=${encodeURIComponent(memberId)}`,
    );
    if (!res.ok) return null;
    return ((await res.json()) as { sealed: string | null }).sealed;
  } catch {
    return null;
  }
}

/** Принять новый ключ группы из конверта. true — приняли, ключ сменился. */
export async function adoptSealedKey(familyId: string, sealed: string): Promise<boolean> {
  const c = await getFamilyConfig(familyId);
  if (!c?.boxPriv || !c.ownerMemberId) return false;
  // Конверт открывается ПУБЛИЧНЫМ ключом владельца — это и есть проверка
  // отправителя: такой же общий секрет не выведет никто, кроме него. Сервер,
  // подложивший свой конверт, получит здесь ошибку расшифровки.
  const owner = await db.familyMembers.get(c.ownerMemberId);
  if (!owner?.boxPub) return false;
  let inner: SealedKeyPayload;
  try {
    inner = await openFrom<SealedKeyPayload>(
      await importBoxPublic(owner.boxPub),
      await importBoxPrivate(c.boxPriv),
      sealed,
    );
  } catch {
    return false;
  }
  if (!inner?.keyRaw || inner.epoch <= epochOf(c)) return false; // старьё или мусор
  const key = await importKeyRaw(inner.keyRaw);
  await patchFamilyConfig(familyId, {
    familyKey: key,
    keyEpoch: inner.epoch,
    keyRing: { ...(c.keyRing ?? {}), [String(inner.epoch)]: key },
    familyToken: inner.familyToken,
    // Своим устройствам новый ключ уедет аккаунтным синком — им конверт
    // забирать не придётся.
    updatedAt: new Date().toISOString(),
  });
  return true;
}

/** Последняя попытка войти, когда сервер отвечает 401: возможно, пока нас не
 *  было, группа сменила ключ. Забираем конверт и пробуем ещё раз. */
export async function recoverAccess(familyId: string): Promise<boolean> {
  const c = await getFamilyConfig(familyId);
  if (!c) return false;
  const sealed = await fetchSealedKey(familyId, c.selfMemberId);
  if (!sealed) return false;
  return adoptSealedKey(familyId, sealed);
}

// === Исключение участника (только владелец) ===

export interface RemovalPlan {
  /** Кого переведём на новый ключ. */
  keeping: FamilyMember[];
  /** У кого нет публичного ключа: новый ключ им передать нечем, и после
   *  исключения они тоже выпадут. Не обновили приложение. */
  stranded: FamilyMember[];
}

/** Что будет, если исключить этого участника. Показываем ДО подтверждения:
 *  «вместе с ним группу потеряют ещё двое» — это должно всплыть заранее, а не
 *  после. */
export async function planRemoval(familyId: string, memberId: string): Promise<RemovalPlan> {
  const c = await getFamilyConfig(familyId);
  const all = await db.familyMembers.where('familyId').equals(familyId).toArray();
  const rest = all.filter((m) => m.id !== memberId && !m.removedAt && !m.leftAt);
  return {
    keeping: rest.filter((m) => m.boxPub || m.id === c?.selfMemberId),
    stranded: rest.filter((m) => !m.boxPub && m.id !== c?.selfMemberId),
  };
}

export class NotOwnerError extends Error {
  constructor() {
    super('Исключать участников может только владелец группы');
    this.name = 'NotOwnerError';
  }
}

/** Исключить участника и перевести группу на новый ключ.
 *
 *  Порядок важен: сначала конверты (их кладём ещё старым токеном, он пока
 *  действует), потом смена ключа на сервере. Наоборот было бы нельзя — после
 *  смены токена мы бы уже не смогли положить конверты. */
export async function removeMember(familyId: string, memberId: string): Promise<RemovalPlan> {
  let c = await getFamilyConfig(familyId);
  if (!c) throw new Error('Группа не найдена');
  const ownerSecret = c.ownerSecret;
  if (!ownerSecret) throw new NotOwnerError();
  c = await ensureBoxKeys(c);
  const plan = await planRemoval(familyId, memberId);

  const epoch = epochOf(c) + 1;
  const key = await generateKey();
  const keyRaw = await exportKeyRaw(key);
  const familyToken = randomToken();
  const myPriv = await importBoxPrivate(c.boxPriv!);
  const payload: SealedKeyPayload = { epoch, keyRaw, familyToken };

  // Себе конверт тоже кладём: у другого моего устройства тот же memberId, и
  // если аккаунтный синк выключен, оно заберёт ключ отсюда.
  const targets = plan.keeping.filter((m) => m.boxPub);
  const selfPub = c.boxPub!;
  const envelopes: { itemId: string; ciphertext: string }[] = [];
  for (const m of targets) {
    envelopes.push({
      itemId: m.id,
      ciphertext: await sealFor(await importBoxPublic(m.boxPub!), myPriv, payload),
    });
  }
  if (!targets.some((m) => m.id === c!.selfMemberId)) {
    envelopes.push({
      itemId: c.selfMemberId,
      ciphertext: await sealFor(await importBoxPublic(selfPub), myPriv, payload),
    });
  }

  for (const e of envelopes) {
    const res = await fetch(`${WORKER_URL}/family/send?familyId=${familyId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.familyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'key', itemId: e.itemId, ciphertext: e.ciphertext }),
    });
    if (!res.ok) throw new Error(`не удалось разложить ключи (${res.status})`);
  }

  const res = await fetch(`${WORKER_URL}/family/remove?familyId=${familyId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.familyToken}`,
      'X-Family-Owner': ownerSecret,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ memberId, newTokenHash: await sha256hex(familyToken) }),
  });
  if (!res.ok) throw new Error(`сервер отказал в исключении (${res.status})`);

  await patchFamilyConfig(familyId, {
    familyKey: key,
    keyEpoch: epoch,
    keyRing: { ...(c.keyRing ?? {}), [String(epoch)]: key },
    familyToken,
    updatedAt: new Date().toISOString(),
  });
  // Пометку об исключении рассылаем УЖЕ новым ключом — исключённому её не
  // прочитать, а остальным она нужна, чтобы показать его в списке зачёркнутым.
  const mem = await db.familyMembers.get(memberId);
  if (mem) await db.familyMembers.put({ ...mem, removedAt: new Date().toISOString(), seq: 0 });
  return plan;
}
