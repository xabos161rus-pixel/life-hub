// Криптографическая часть исключения участника: личные конверты, эпохи ключа
// и связка ключей в приглашении. Работа с сетью и базой сюда не входит — здесь
// проверяется ровно то, на чём держится гарантия «исключённый не прочитает».

import { describe, expect, it } from 'vitest';
import {
  exportBoxPrivate,
  exportBoxPublic,
  exportKeyRaw,
  generateBoxKeyPair,
  generateKey,
  importBoxPrivate,
  importBoxPublic,
  importKeyRaw,
  decryptJSON,
  encryptJSON,
  openFrom,
  openInvite,
  packEpoch,
  sealFor,
  sealInvite,
  sha256hex,
  unpackEpoch,
} from './crypto';

async function member() {
  const pair = await generateBoxKeyPair();
  return {
    pub: await exportBoxPublic(pair.publicKey),
    priv: await exportBoxPrivate(pair.privateKey),
  };
}

describe('личный конверт участника', () => {
  it('адресат открывает свой конверт', async () => {
    const owner = await member();
    const alice = await member();
    const sealed = await sealFor(
      await importBoxPublic(alice.pub),
      await importBoxPrivate(owner.priv),
      { epoch: 1, keyRaw: 'секрет' },
    );
    const opened = await openFrom<{ epoch: number; keyRaw: string }>(
      await importBoxPublic(owner.pub),
      await importBoxPrivate(alice.priv),
      sealed,
    );
    expect(opened).toEqual({ epoch: 1, keyRaw: 'секрет' });
  });

  it('исключённый не открывает чужой конверт', async () => {
    // Главное свойство всей схемы. У исключённого на руках старый ключ группы,
    // старый токен и весь трафик — и ни один конверт ему не поддаётся.
    const owner = await member();
    const alice = await member();
    const kicked = await member();
    const sealed = await sealFor(
      await importBoxPublic(alice.pub),
      await importBoxPrivate(owner.priv),
      { keyRaw: 'новый ключ группы' },
    );
    await expect(
      openFrom(await importBoxPublic(owner.pub), await importBoxPrivate(kicked.priv), sealed),
    ).rejects.toThrow();
  });

  it('конверт от чужого имени не открывается ключом владельца', async () => {
    // Подмена сервером: он кладёт свой конверт вместо владельцева, чтобы
    // навязать участнику ключ, который знает сам. Получатель деривирует секрет
    // ПУБЛИЧНЫМ ключом владельца — и не сходится.
    const owner = await member();
    const evil = await member();
    const alice = await member();
    const sealed = await sealFor(
      await importBoxPublic(alice.pub),
      await importBoxPrivate(evil.priv),
      { keyRaw: 'ключ злодея' },
    );
    await expect(
      openFrom(await importBoxPublic(owner.pub), await importBoxPrivate(alice.priv), sealed),
    ).rejects.toThrow();
  });

  it('конверт самому себе открывается — это второе устройство владельца', async () => {
    const owner = await member();
    const sealed = await sealFor(
      await importBoxPublic(owner.pub),
      await importBoxPrivate(owner.priv),
      { keyRaw: 'себе' },
    );
    const opened = await openFrom<{ keyRaw: string }>(
      await importBoxPublic(owner.pub),
      await importBoxPrivate(owner.priv),
      sealed,
    );
    expect(opened.keyRaw).toBe('себе');
  });

  it('публичный ключ переживает выгрузку и загрузку', async () => {
    const m = await member();
    const again = await exportBoxPublic(await importBoxPublic(m.pub));
    expect(again).toBe(m.pub);
  });
});

describe('эпоха в шифротексте', () => {
  it('нулевая эпоха не оставляет следа', () => {
    // Записи, сделанные до появления ротации, лежат без префикса. Добавь мы его
    // задним числом — старая переписка перестала бы читаться.
    expect(packEpoch(0, 'abc')).toBe('abc');
    expect(unpackEpoch('abc')).toEqual({ epoch: 0, payload: 'abc' });
  });

  it('ненулевая помечается и разбирается обратно', () => {
    expect(unpackEpoch(packEpoch(7, 'abc'))).toEqual({ epoch: 7, payload: 'abc' });
  });

  it('base64url не путается с разделителем', () => {
    // В base64url нет точки — значит первая точка всегда наша.
    const payload = 'aB-_09xyz';
    expect(unpackEpoch(packEpoch(12, payload)).payload).toBe(payload);
  });

  it('шифротекст читается только ключом своей эпохи', async () => {
    const oldKey = await generateKey();
    const newKey = await generateKey();
    const packed = packEpoch(1, await encryptJSON(newKey, { text: 'после исключения' }));
    const { epoch, payload } = unpackEpoch(packed);
    expect(epoch).toBe(1);
    await expect(decryptJSON(oldKey, payload)).rejects.toThrow();
    await expect(decryptJSON(newKey, payload)).resolves.toEqual({ text: 'после исключения' });
  });
});

describe('связка ключей в приглашении', () => {
  it('новый участник получает все эпохи и читает старую переписку', async () => {
    const e0 = await generateKey();
    const e1 = await generateKey();
    const oldMessage = await encryptJSON(e0, { text: 'до исключения' });
    const code = await sealInvite(
      {
        familyId: 'f1',
        familyToken: 't',
        familyName: 'Семья',
        key: await exportKeyRaw(e1),
        keys: { '0': await exportKeyRaw(e0), '1': await exportKeyRaw(e1) },
        epoch: 1,
      },
      'ABCD2345',
    );
    const got = await openInvite(code, 'ABCD2345');
    expect(got.epoch).toBe(1);
    expect(Object.keys(got.keys ?? {})).toEqual(['0', '1']);
    const restored = await importKeyRaw(got.keys!['0']);
    await expect(decryptJSON(restored, oldMessage)).resolves.toEqual({ text: 'до исключения' });
  });

  it('приглашение без связки остаётся рабочим', async () => {
    // Коды, выпущенные до появления ротации: одна эпоха, поля keys нет вовсе.
    const key = await generateKey();
    const code = await sealInvite(
      { familyId: 'f1', familyToken: 't', familyName: 'Семья', key: await exportKeyRaw(key) },
      'ABCD2345',
    );
    const got = await openInvite(code, 'ABCD2345');
    expect(got.keys).toBeUndefined();
    expect(got.key).toBe(await exportKeyRaw(key));
  });
});

describe('секрет владельца', () => {
  it('хеш совпадает с тем, что считает сервер', async () => {
    // Сервер считает sha256 в hex тем же способом — если разойдётся, владелец
    // не сможет исключить никого и не поймёт почему.
    expect(await sha256hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
