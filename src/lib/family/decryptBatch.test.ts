// Что происходит с сообщениями, зашифрованными ключом, которого у нас ещё нет.
//
// Крипто настоящее (WebCrypto через encFamily/decFamily), подменяется только
// поход за ключом — в жизни это запрос к серверу.

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { FamilyConfig } from '../../db/types';
import { generateKey } from '../crypto';
import { encFamily } from './familyKeys';
import { decryptBatch } from './decryptBatch';

async function makeConfig(epoch: number, ring: Record<string, CryptoKey>): Promise<FamilyConfig> {
  return {
    id: 'f1',
    familyId: 'f1',
    familyToken: 't',
    familyKey: ring[String(epoch)],
    familyName: 'Наши',
    selfMemberId: 'me',
    lastSeq: 0,
    lastReadSeq: 0,
    enabled: true,
    joinedAt: new Date(2026, 0, 1).toISOString(),
    keyEpoch: epoch,
    keyRing: ring,
  } as unknown as FamilyConfig;
}

/** Старый конфиг (эпоха 0) и новый (эпоха 1, со связкой обоих ключей). */
async function twoEpochs() {
  const k0 = await generateKey();
  const k1 = await generateKey();
  const old = await makeConfig(0, { '0': k0 });
  const fresh = await makeConfig(1, { '0': k0, '1': k1 });
  return { old, fresh };
}

const item = (ciphertext: string, channel = 'msg') => ({ ciphertext, channel });

describe('расшифровка пачки входящих', () => {
  it('читает всё, что зашифровано известным ключом, и за новым не ходит', async () => {
    const { old } = await twoEpochs();
    const items = [item(await encFamily(old, { text: 'раз' })), item(await encFamily(old, { text: 'два' }))];
    const recover = vi.fn();

    const res = await decryptBatch(old, items, recover);

    expect(res.decoded.map((d) => d.p.text)).toEqual(['раз', 'два']);
    expect(res.failed).toEqual([]);
    expect(recover).not.toHaveBeenCalled();
  });

  it('после смены ключа группы забирает новый и дочитывает сообщение', async () => {
    // Ровно та ситуация, ради которой всё сделано: устройство было закрыто,
    // когда рассылали новый ключ, и сообщение пришло нечитаемым.
    const { old, fresh } = await twoEpochs();
    const items = [item(await encFamily(fresh, { text: 'после исключения' }))];

    const res = await decryptBatch(old, items, async () => fresh);

    expect(res.decoded.map((d) => d.p.text)).toEqual(['после исключения']);
    expect(res.failed).toEqual([]);
    // И дальше работаем уже новым конфигом, а не старым.
    expect(res.config.keyEpoch).toBe(1);
  });

  it('порядок сообщений сохраняется, даже если часть дочитана со второго захода', async () => {
    // Порядок держит последовательность событий в ленте: дочитанное не должно
    // оказываться в конце переписки.
    const { old, fresh } = await twoEpochs();
    const items = [
      item(await encFamily(old, { text: 'первое' })),
      item(await encFamily(fresh, { text: 'второе' })),
      item(await encFamily(old, { text: 'третье' })),
    ];

    const res = await decryptBatch(old, items, async () => fresh);

    expect(res.decoded.map((d) => d.p.text)).toEqual(['первое', 'второе', 'третье']);
  });

  it('если ключа взять негде, сообщение попадает в потерянные, а не исчезает', async () => {
    const { old, fresh } = await twoEpochs();
    const items = [item(await encFamily(fresh, { text: 'не прочитаем' }))];

    const res = await decryptBatch(old, items, async () => null);

    expect(res.decoded).toEqual([]);
    expect(res.failed).toHaveLength(1);
    expect(res.config).toBe(old);
  });

  it('за ключом ходим один раз на пачку, а не на каждое сообщение', async () => {
    const { old, fresh } = await twoEpochs();
    const items = [
      item(await encFamily(fresh, { text: 'а' })),
      item(await encFamily(fresh, { text: 'б' })),
      item(await encFamily(fresh, { text: 'в' })),
    ];
    const recover = vi.fn(async () => fresh);

    await decryptBatch(old, items, recover);

    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('битый шифротекст не роняет остальную пачку', async () => {
    const { old } = await twoEpochs();
    const items = [item('мусор'), item(await encFamily(old, { text: 'живое' }))];

    const res = await decryptBatch(old, items, async () => null);

    expect(res.decoded.map((d) => d.p.text)).toEqual(['живое']);
    expect(res.failed).toHaveLength(1);
  });
});
