// Поиск по переписке: что находится, что нет и в каком порядке.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { searchMessages } from './searchMessages';

type Row = Partial<FamilyRow> & { text?: string };
interface FamilyRow {
  seq: number;
  text: string;
  deletedAt: string | null;
  system: unknown;
  reaction: unknown;
  fileChunk: unknown;
  file: { name: string; mime: string; size: number; chunksTotal: number; fileId: string };
}

async function seed(rows: Row[]) {
  await db.familyMessages.clear();
  await db.familyMessages.bulkPut(
    rows.map((r, i) => ({
      clientMsgId: `m${i}`,
      familyId: 'f1',
      seq: r.seq ?? i + 1,
      senderMemberId: 'p1',
      text: r.text ?? '',
      createdAt: new Date(2026, 0, 1 + i).toISOString(),
      deletedAt: r.deletedAt ?? null,
      system: r.system,
      reaction: r.reaction,
      fileChunk: r.fileChunk,
      file: r.file,
    })) as never[],
  );
}

const texts = async (q: string) => (await searchMessages('f1', q)).map((h) => h.message.text);

describe('поиск по переписке', () => {
  beforeEach(async () => {
    await db.open();
  });

  it('находит сообщение по куску слова', async () => {
    await seed([{ text: 'Встречаемся на Белорусском вокзале' }, { text: 'Куплю хлеб' }]);
    expect(await texts('вокзал')).toEqual(['Встречаемся на Белорусском вокзале']);
  });

  it('регистр не важен', async () => {
    await seed([{ text: 'Адрес: Тверская 12' }]);
    expect(await texts('тверская')).toHaveLength(1);
    expect(await texts('ТВЕРСКАЯ')).toHaveLength(1);
  });

  it('«ё» и «е» считаются одной буквой — их путают при наборе', async () => {
    await seed([{ text: 'Привезёт колёса завтра' }]);
    expect(await texts('привезет')).toHaveLength(1);
    expect(await texts('колеса')).toHaveLength(1);
  });

  it('свежие находки идут первыми: нужное обычно недавнее', async () => {
    await seed([
      { seq: 1, text: 'колёса старые' },
      { seq: 2, text: 'колёса новые' },
    ]);
    expect(await texts('колеса')).toEqual(['колёса новые', 'колёса старые']);
  });

  it('отдаёт границы совпадения — по ним подсвечивается найденное', async () => {
    await seed([{ text: 'Заберу колёса в субботу' }]);
    const [hit] = await searchMessages('f1', 'колеса');
    expect(hit.message.text.slice(hit.from, hit.to)).toBe('колёса');
  });

  it('удалённые, служебные, реакции и куски файлов не находятся', async () => {
    await seed([
      { text: 'колёса удалённые', deletedAt: new Date().toISOString() },
      { text: 'колёса служебные', system: { kind: 'joined', memberId: 'p1' } },
      { text: 'колёса реакция', reaction: { targetId: 'm0', emoji: '❤️' } },
      { text: 'колёса кусок', fileChunk: { fileId: 'f', index: 0, total: 2, data: 'x' } },
      { text: 'колёса живые' },
    ]);
    expect(await texts('колеса')).toEqual(['колёса живые']);
  });

  it('находит по имени приложенного файла', async () => {
    await seed([
      { text: '', file: { fileId: 'f1', name: 'договор-аренды.pdf', mime: 'application/pdf', size: 10, chunksTotal: 1 } },
    ]);
    expect(await searchMessages('f1', 'аренды')).toHaveLength(1);
  });

  it('по одной букве не ищем: нашлась бы вся переписка', async () => {
    await seed([{ text: 'абвгд' }, { text: 'абвгд ещё' }]);
    expect(await searchMessages('f1', 'а')).toEqual([]);
    expect(await searchMessages('f1', '  ')).toEqual([]);
  });

  it('чужая группа не подмешивается', async () => {
    await seed([{ text: 'колёса тут' }]);
    await db.familyMessages.put({
      clientMsgId: 'other',
      familyId: 'f2',
      seq: 1,
      senderMemberId: 'p9',
      text: 'колёса в другой группе',
      createdAt: new Date().toISOString(),
      deletedAt: null,
    } as never);
    expect(await texts('колеса')).toEqual(['колёса тут']);
  });
});
