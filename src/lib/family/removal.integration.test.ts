// Сквозная проверка исключения участника: настоящий клиент против настоящего
// сервера.
//
// Отдельные части уже покрыты — крипто конвертов в src/lib/familyKeys.test.ts,
// поведение комнаты в worker/familyRoom.test.ts. Но контракт между ними ничем
// не проверялся, а именно там ошибка обходится дороже всего: разойдись имя
// поля или порядок вызовов, и семейный чат сломается у всех разом в момент
// выката воркера.
//
// Поэтому здесь берутся обе реализации как есть: клиентские функции из
// familyKeys.ts и Durable Object из worker/src/familyRoom.js поверх
// node:sqlite. Подменяется ровно транспорт — глобальный fetch направляется в
// комнату вместо сети. Крипто настоящее (WebCrypto), база настоящая (Dexie
// поверх fake-indexeddb).

import 'fake-indexeddb/auto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { FamilyRoom } = await import('../../../worker/src/familyRoom.js');
const { db } = await import('../../db/db');
const { generateKey, exportKeyRaw, importKeyRaw, encryptJSON, newAccountId, randomToken } =
  await import('../crypto');
const {
  adoptSealedKey,
  decFamily,
  encFamily,
  ensureBoxKeys,
  planRemoval,
  recoverAccess,
  registerMember,
  removeMember,
  NotOwnerError,
} = await import('./familyKeys');
const { getFamilyConfig, patchFamilyConfig } = await import('./familyState');

// === Комната на node:sqlite, доступная через подменённый fetch ===

const FAMILY_ID = 'fam-1';
let room: InstanceType<typeof FamilyRoom>;
let sockets: { memberId: string | null; closed: number | null; sent: string[] }[] = [];

function bootRoom() {
  const sdb = new DatabaseSync(':memory:');
  sockets = [];
  const sql = {
    exec(query: string, ...params: unknown[]) {
      if (params.length === 0 && /;\s*\S/.test(query.trim())) {
        sdb.exec(query);
        return { toArray: () => [] };
      }
      const st = sdb.prepare(query);
      const rows = /^\s*SELECT/i.test(query)
        ? st.all(...(params as never[]))
        : (st.run(...(params as never[])), []);
      return { toArray: () => rows };
    },
  };
  room = new FamilyRoom(
    {
      storage: { sql, setAlarm: () => Promise.resolve() },
      getWebSockets: () => sockets,
      waitUntil: (p: Promise<unknown>) => void p,
      acceptWebSocket: () => {},
    },
    {},
  );
}

const realFetch = globalThis.fetch;

function routeToRoom() {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (!url.includes('/family/')) return realFetch(input as RequestInfo, init);
    return room.fetch(new Request(url, init));
  }) as typeof fetch;
}

// === Заведение участников ===

async function makeMember(opts: { owner?: boolean; token: string }) {
  const memberId = newAccountId();
  const key = await importKeyRaw(opts.token === '' ? await exportKeyRaw(await generateKey()) : GROUP_KEY_RAW);
  await db.family.put({
    id: FAMILY_ID,
    familyId: FAMILY_ID,
    familyToken: opts.token,
    familyKey: key,
    familyName: 'Семья',
    selfMemberId: memberId,
    lastSeq: 0,
    lastReadSeq: 0,
    enabled: true,
    joinedAt: new Date().toISOString(),
    keyEpoch: 0,
    keyRing: { '0': key },
    ...(opts.owner ? { ownerSecret: randomToken(), ownerMemberId: memberId } : {}),
  });
  const c = await ensureBoxKeys((await getFamilyConfig(FAMILY_ID))!);
  await registerMember(FAMILY_ID);
  // Публичный ключ участника живёт в шифрованном канале 'member'; здесь пишем
  // его прямо в локальную таблицу — транспорт канала не предмет этого теста.
  await db.familyMembers.put({
    id: memberId,
    familyId: FAMILY_ID,
    seq: 1,
    displayName: memberId.slice(0, 4),
    color: '#888',
    joinedAt: new Date().toISOString(),
    leftAt: null,
    boxPub: c.boxPub,
    removedAt: null,
  });
  return memberId;
}

/** Снимок конфига участника: в базе живёт ОДНА строка family, а участников в
 *  тесте несколько. Переключаемся между ними, сохраняя и восстанавливая её. */
type Snapshot = Awaited<ReturnType<typeof getFamilyConfig>>;
async function snapshot(): Promise<Snapshot> {
  return getFamilyConfig(FAMILY_ID);
}
async function restore(s: Snapshot) {
  if (s) await db.family.put(s);
}

let GROUP_KEY_RAW = '';
const TOKEN = 'group-token-1';

describe('исключение участника: клиент против сервера', () => {
  let ownerCfg: Snapshot;
  let aliceCfg: Snapshot;
  let kickedCfg: Snapshot;
  let ownerId = '';
  let aliceId = '';
  let kickedId = '';

  beforeEach(async () => {
    bootRoom();
    routeToRoom();
    await db.family.clear();
    await db.familyMembers.clear();
    GROUP_KEY_RAW = await exportKeyRaw(await generateKey());

    ownerId = await makeMember({ owner: true, token: TOKEN });
    ownerCfg = await snapshot();
    aliceId = await makeMember({ token: TOKEN });
    aliceCfg = await snapshot();
    kickedId = await makeMember({ token: TOKEN });
    kickedCfg = await snapshot();
    // Каждый участник узнал публичные ключи остальных — так их разносит канал
    // 'member' в работающем приложении.
    await restore(ownerCfg);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('владелец исключает: остальные получают новый ключ, исключённый — нет', async () => {
    const plan = await removeMember(FAMILY_ID, kickedId);
    expect(plan.stranded).toEqual([]);
    expect(plan.keeping.map((m) => m.id).sort()).toEqual([aliceId, ownerId].sort());

    const afterOwner = (await snapshot())!;
    expect(afterOwner.keyEpoch).toBe(1);
    expect(afterOwner.familyToken).not.toBe(TOKEN);
    // Старый ключ никуда не делся — прошлая переписка обязана читаться.
    expect(Object.keys(afterOwner.keyRing!).sort()).toEqual(['0', '1']);

    // Сообщение, написанное уже после исключения.
    const secret = await encFamily(afterOwner, { text: 'после исключения' });
    expect(secret.startsWith('e1.')).toBe(true);

    // Алиса была офлайн: приходит со старым токеном и восстанавливает доступ.
    await restore(aliceCfg);
    expect(await recoverAccess(FAMILY_ID)).toBe(true);
    const alice = (await snapshot())!;
    expect(alice.keyEpoch).toBe(1);
    expect(alice.familyToken).toBe(afterOwner.familyToken);
    await expect(decFamily(alice, secret)).resolves.toEqual({ text: 'после исключения' });

    // Исключённый: конверта ему нет, ключ остался старый, сообщение не читается.
    await restore(kickedCfg);
    expect(await recoverAccess(FAMILY_ID)).toBe(false);
    const kicked = (await snapshot())!;
    expect(kicked.keyEpoch ?? 0).toBe(0);
    await expect(decFamily(kicked, secret)).rejects.toThrow();
  });

  it('исключённому отвечают 403, а не 401', async () => {
    // Разница принципиальная. 401 значит «токен устарел, забери новый конверт»,
    // и приложение честно уходит в цикл переподключений. Исключённому нужен
    // отдельный ответ, иначе он до скончания века видит «подключение…» и не
    // узнаёт, что произошло.
    await removeMember(FAMILY_ID, kickedId);
    await restore(kickedCfg);
    const res = await fetch(
      `https://x/family/ticket?familyId=${FAMILY_ID}&memberId=${kickedId}`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(403);
  });

  it('оставшемуся со старым токеном отвечают 401 — ему есть что забрать', async () => {
    await removeMember(FAMILY_ID, kickedId);
    await restore(aliceCfg);
    const res = await fetch(
      `https://x/family/ticket?familyId=${FAMILY_ID}&memberId=${aliceId}`,
      { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(401);
  });

  it('прошлая переписка остаётся читаемой после смены ключа', async () => {
    // Ради этого и держится связка ключей: иначе исключение кого-то одного
    // превратило бы всю историю группы в нечитаемые записи у всех остальных.
    const before = (await snapshot())!;
    const oldMessage = await encFamily(before, { text: 'до исключения' });
    await removeMember(FAMILY_ID, kickedId);
    const after = (await snapshot())!;
    await expect(decFamily(after, oldMessage)).resolves.toEqual({ text: 'до исключения' });
  });

  it('не владелец исключить не может', async () => {
    await restore(aliceCfg);
    await expect(removeMember(FAMILY_ID, kickedId)).rejects.toThrow(NotOwnerError);
  });

  it('участник без публичного ключа назван до подтверждения, а не после', async () => {
    // Старая версия приложения: ключа нет, передать новый нечем. Человек должен
    // узнать об этом до нажатия, иначе он просто потеряет двоих вместо одного.
    await db.familyMembers.update(aliceId, { boxPub: undefined });
    const plan = await planRemoval(FAMILY_ID, kickedId);
    expect(plan.stranded.map((m) => m.id)).toEqual([aliceId]);
    expect(plan.keeping.map((m) => m.id)).toEqual([ownerId]);
  });

  it('повторное исключение поднимает эпоху ещё раз', async () => {
    await removeMember(FAMILY_ID, kickedId);
    const mid = (await snapshot())!;
    const midMessage = await encFamily(mid, { text: 'между исключениями' });
    await removeMember(FAMILY_ID, aliceId);
    const end = (await snapshot())!;
    expect(end.keyEpoch).toBe(2);
    expect(Object.keys(end.keyRing!).sort()).toEqual(['0', '1', '2']);
    await expect(decFamily(end, midMessage)).resolves.toEqual({ text: 'между исключениями' });
  });

  it('чужой конверт не принимается', async () => {
    // Сервер подменил конверт своим, чтобы навязать участнику известный себе
    // ключ. Проверка отправителя — дериватор с публичным ключом владельца.
    await removeMember(FAMILY_ID, kickedId);
    await restore(aliceCfg);
    const fakeKey = await generateKey();
    const fake = await encryptJSON(fakeKey, { epoch: 9, keyRaw: 'x', familyToken: 'y' });
    expect(await adoptSealedKey(FAMILY_ID, fake)).toBe(false);
    expect((await snapshot())!.keyEpoch ?? 0).toBe(0); // ключ не тронут
  });

  it('устаревший конверт не откатывает ключ назад', async () => {
    // Конверт первой эпохи мог долежать до второй. Принять его — значит
    // потерять доступ к свежей переписке.
    await removeMember(FAMILY_ID, kickedId);
    const sealedFirst = await (
      await fetch(`https://x/family/keys?familyId=${FAMILY_ID}&member=${aliceId}`)
    ).json();
    await restore(aliceCfg);
    expect(await adoptSealedKey(FAMILY_ID, sealedFirst.sealed)).toBe(true);
    await patchFamilyConfig(FAMILY_ID, { keyEpoch: 5 }); // ушли вперёд
    expect(await adoptSealedKey(FAMILY_ID, sealedFirst.sealed)).toBe(false);
  });
});
