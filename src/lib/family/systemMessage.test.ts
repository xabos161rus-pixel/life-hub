import { afterEach, describe, expect, it } from 'vitest';
import { formatCallDuration, systemEventText, systemMessageText } from './systemMessage';
import { setLang } from '../i18n';

afterEach(() => setLang('ru'));

describe('типизированные системные сообщения чата', () => {
  it('русский зритель: все три события', () => {
    expect(systemEventText({ kind: 'join', name: 'Вася' })).toBe('Вася теперь в группе');
    expect(systemEventText({ kind: 'call', sec: 187 })).toBe('📞 Аудиозвонок · 3:07');
    expect(systemEventText({ kind: 'callMissed' })).toBe('📵 Пропущенный аудиозвонок');
  });

  it('английский зритель видит то же событие на своём языке', () => {
    setLang('en');
    // text сохранён по-русски (язык отправителя) — рендер обязан игнорировать
    // его и раскрыть kind+params на языке зрителя. Это суть per-viewer.
    const m = { text: 'Вася присоединился', sys: { kind: 'join', name: 'Вася' } as const };
    expect(systemMessageText(m)).toBe('Вася is now in the group');
    expect(systemEventText({ kind: 'call', sec: 61 })).toBe('📞 Audio call · 1:01');
    expect(systemEventText({ kind: 'callMissed' })).toBe('📵 Missed audio call');
  });

  it('старая история без события показывает text дословно', () => {
    setLang('en');
    expect(systemMessageText({ text: 'Вася присоединился', sys: null })).toBe('Вася присоединился');
    expect(systemMessageText({ text: '📞 Аудиозвонок · 3:07' })).toBe('📞 Аудиозвонок · 3:07');
  });

  it('незнакомый kind (клиент будущей версии) падает в text', () => {
    const m = {
      text: 'Группа переименована',
      sys: { kind: 'rename', name: 'Дом' } as unknown as import('../../db/types').FamilySystemEvent,
    };
    expect(systemMessageText(m)).toBe('Группа переименована');
  });

  it('join без имени: заглушка тоже локализуется у зрителя', () => {
    expect(systemMessageText({ text: 'x', sys: { kind: 'join' } })).toBe('Участник теперь в группе');
    expect(systemMessageText({ text: 'x', sys: { kind: 'join', name: '  ' } })).toBe('Участник теперь в группе');
    setLang('en');
    expect(systemMessageText({ text: 'x', sys: { kind: 'join' } })).toBe('Member is now in the group');
  });

  it('имя с долларовыми паттернами вставляется дословно', () => {
    // replaceAll со строковой заменой съел бы $$ / $& — подстановка функцией.
    setLang('en');
    expect(systemEventText({ kind: 'join', name: 'Ba$$ Boy' })).toBe('Ba$$ Boy is now in the group');
    expect(systemEventText({ kind: 'join', name: '$&' })).toBe('$& is now in the group');
  });

  it('битые params с провода не роняют рендер — fallback в text', () => {
    const broken = (sys: unknown) =>
      systemMessageText({ text: 'запасной текст', sys: sys as never });
    expect(broken({ kind: 'call', sec: 'долго' })).toBe('запасной текст'); // sec не число
    expect(broken({ kind: 'call', sec: NaN })).toBe('запасной текст');
    expect(broken({ kind: 'call', sec: 0 })).toBe('запасной текст'); // звонок без секунд
    expect(broken({ kind: 'call', sec: 0.5 })).toBe('запасной текст'); // floor до проверки: «0:00» нечего показывать
    expect(broken({ kind: 'join', name: 42 })).toBe('запасной текст'); // name не строка
    expect(broken('строка')).toBe('запасной текст');
  });

  it('длительность звонка форматируется как М:СС', () => {
    expect(formatCallDuration(59)).toBe('0:59');
    expect(formatCallDuration(60)).toBe('1:00');
    expect(formatCallDuration(61)).toBe('1:01');
    expect(formatCallDuration(3725)).toBe('62:05'); // часы не отделяем — как в старом журнале
  });
});
