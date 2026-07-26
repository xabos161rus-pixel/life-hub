import { describe, expect, it } from 'vitest';
import {
  InviteExpiredError,
  InviteWordError,
  formatInviteWord,
  generateInviteWord,
  normalizeInviteWord,
  openInvite,
  peekInvite,
  sealInvite,
} from './crypto';

const DATA = {
  familyId: 'fam-1',
  familyToken: 'secret-token',
  key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  familyName: 'Наша семья',
};

describe('кодовое слово', () => {
  it('восемь символов из алфавита без похожих', () => {
    for (let i = 0; i < 50; i++) {
      const w = generateInviteWord();
      expect(w).toHaveLength(8);
      // Ни O, ни 0, ни I, ни 1 — их путают на слух и при наборе.
      expect(w).not.toMatch(/[OI0L1]/);
      expect(w).toMatch(/^[A-Z2-9]+$/);
    }
  });

  it('слова не повторяются', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateInviteWord()));
    expect(seen.size).toBe(200);
  });

  it('нормализация прощает регистр и пробелы, но не выдумывает символы', () => {
    expect(normalizeInviteWord('abcd efgh')).toBe('ABCDEFGH');
    expect(normalizeInviteWord('ab-cd-ef-gh')).toBe('ABCDEFGH');
    // Ввод с O остаётся с O: подменять нечем, в алфавите такого символа нет.
    expect(normalizeInviteWord('OBCDEFGH')).toBe('OBCDEFGH');
  });

  it('показывается группами по четыре', () => {
    expect(formatInviteWord('ABCDEFGH')).toBe('ABCD EFGH');
  });
});

describe('приглашение под кодовым словом', () => {
  it('открывается верным словом', async () => {
    const word = generateInviteWord();
    const code = await sealInvite(DATA, word);
    const opened = await openInvite(code, word);
    expect(opened).toEqual(DATA);
  });

  it('прощает регистр и пробелы при вводе', async () => {
    const word = 'ABCDEFGH';
    const code = await sealInvite(DATA, word);
    const opened = await openInvite(code, 'abcd efgh');
    expect(opened.familyToken).toBe(DATA.familyToken);
  });

  it('не открывается неверным словом', async () => {
    const code = await sealInvite(DATA, 'ABCDEFGH');
    await expect(openInvite(code, 'ABCDEFGJ')).rejects.toBeInstanceOf(InviteWordError);
  });

  it('ключ и токен не читаются из кода без слова', async () => {
    const code = await sealInvite(DATA, generateInviteWord());
    // Именно то, ради чего всё затевалось: перехваченный код не выдаёт ключ.
    const decoded = Buffer.from(code, 'base64url').toString('utf8');
    expect(decoded).not.toContain(DATA.key);
    expect(decoded).not.toContain(DATA.familyToken);
  });

  it('название группы видно до ввода слова', async () => {
    const code = await sealInvite(DATA, generateInviteWord());
    const peeked = peekInvite(code);
    expect(peeked.familyName).toBe('Наша семья');
    expect(peeked.familyId).toBe('fam-1');
  });

  it('просроченное приглашение не открывается', async () => {
    const word = generateInviteWord();
    const code = await sealInvite(DATA, word, -1); // истекло час назад
    await expect(openInvite(code, word)).rejects.toBeInstanceOf(InviteExpiredError);
  });

  it('испорченный код не проходит проверку формата', () => {
    expect(() => peekInvite('не-код')).toThrow();
  });
});
