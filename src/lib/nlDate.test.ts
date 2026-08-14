import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeParsed, parseQuickTask } from './nlDate';
import { setLang } from './i18n';

// Дата зафиксирована: среда 12 августа 2026, полдень. Все ожидания — точными
// строками, а не пересчётом через те же хелперы (иначе тест зеркалил бы код).
const NOW = new Date(2026, 7, 12, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  setLang('ru');
});

describe('быстрый ввод: русская грамматика', () => {
  it('дата и время из фразы уходят в поля, заголовок очищается', () => {
    const p = parseQuickTask('Позвонить маме завтра в 18:00');
    expect(p).toMatchObject({
      title: 'Позвонить маме',
      dueDate: '2026-08-13',
      dueTime: '18:00',
    });
  });

  it('«сегодня» и «послезавтра»', () => {
    expect(parseQuickTask('отчёт сегодня').dueDate).toBe('2026-08-12');
    expect(parseQuickTask('отчёт послезавтра').dueDate).toBe('2026-08-14');
  });

  it('«через N дней/неделю/месяца»', () => {
    expect(parseQuickTask('врач через 3 дня').dueDate).toBe('2026-08-15');
    expect(parseQuickTask('врач через неделю').dueDate).toBe('2026-08-19');
    expect(parseQuickTask('врач через 2 месяца').dueDate).toBe('2026-10-12');
  });

  it('явная дата: прошедшая в этом году переезжает на следующий', () => {
    expect(parseQuickTask('налог 15 июня').dueDate).toBe('2027-06-15');
    expect(parseQuickTask('налог 15 июня 2027').dueDate).toBe('2027-06-15');
    expect(parseQuickTask('встреча 5 сентября').dueDate).toBe('2026-09-05');
  });

  it('числовая дата с точкой; несуществующая — не дата', () => {
    expect(parseQuickTask('встреча 05.09').dueDate).toBe('2026-09-05');
    const p = parseQuickTask('корм 31.02');
    expect(p.dueDate).toBeNull();
    expect(p.title).toBe('корм 31.02');
  });

  it('«2.50 кг» — десятичное число остаётся в заголовке', () => {
    const p = parseQuickTask('купить 2.50 кг сахара');
    expect(p.dueDate).toBeNull();
    expect(p.title).toBe('купить 2.50 кг сахара');
  });

  it('дни недели: ближайший будущий, тот же день — через неделю', () => {
    expect(parseQuickTask('зал в пятницу').dueDate).toBe('2026-08-14');
    expect(parseQuickTask('зал в среду').dueDate).toBe('2026-08-19');
  });

  it('«в следующий понедельник» — понедельник следующей недели', () => {
    expect(parseQuickTask('созвон в следующий понедельник').dueDate).toBe('2026-08-17');
  });

  it('части дня дают время, без даты означают сегодня', () => {
    expect(parseQuickTask('пробежка вечером')).toMatchObject({
      dueDate: '2026-08-12',
      dueTime: '19:00',
    });
    expect(parseQuickTask('пробежка завтра утром')).toMatchObject({
      dueDate: '2026-08-13',
      dueTime: '09:00',
    });
  });

  it('час словами: «в 9», «в 7 вечера», «в 12 ночи»', () => {
    expect(parseQuickTask('кофе в 9').dueTime).toBe('09:00');
    expect(parseQuickTask('ужин в 7 вечера').dueTime).toBe('19:00');
    expect(parseQuickTask('такси в 12 ночи').dueTime).toBe('00:00');
  });

  it('время без даты означает сегодня', () => {
    expect(parseQuickTask('обед в 14:30')).toMatchObject({
      dueDate: '2026-08-12',
      dueTime: '14:30',
    });
  });

  it('приоритет и теги', () => {
    const p = parseQuickTask('хлеб !! #дом #еда');
    expect(p.priority).toBe(2);
    expect(p.tags).toEqual(['дом', 'еда']);
    expect(p.title).toBe('хлеб');
  });

  it('фраза без токенов остаётся заголовком без даты', () => {
    expect(parseQuickTask('Купить хлеб')).toMatchObject({
      title: 'Купить хлеб',
      dueDate: null,
      dueTime: null,
    });
  });

  it('английская грамматика в русском интерфейсе не работает', () => {
    expect(parseQuickTask('call mom tomorrow').dueDate).toBeNull();
  });

  it('ввод из одних токенов: заголовком остаётся исходная строка', () => {
    expect(parseQuickTask('завтра').title).toBe('завтра');
  });

  it('минуты за пределом клампятся в 59 (фиксация исходного поведения RU-ветки)', () => {
    // Не одобрение: EN-ветка невалидное время не трогает. Русское поведение
    // оставлено как было и закреплено, чтобы смена контракта была видимой.
    expect(parseQuickTask('встреча 8:70').dueTime).toBe('08:59');
  });
});

describe('быстрый ввод: английская грамматика', () => {
  beforeEach(() => setLang('en'));

  it('обещание из подсказки: «tomorrow at 10 call mom»', () => {
    const p = parseQuickTask('tomorrow at 10 call mom');
    expect(p).toMatchObject({
      title: 'call mom',
      dueDate: '2026-08-13',
      dueTime: '10:00',
    });
  });

  it('today / day after tomorrow / tomorrow', () => {
    expect(parseQuickTask('report today').dueDate).toBe('2026-08-12');
    expect(parseQuickTask('report day after tomorrow').dueDate).toBe('2026-08-14');
    expect(parseQuickTask('report the day after tomorrow').dueDate).toBe('2026-08-14');
    expect(parseQuickTask('report tomorrow').dueDate).toBe('2026-08-13');
  });

  it('in N days / in a week / in 2 months', () => {
    expect(parseQuickTask('dentist in 3 days').dueDate).toBe('2026-08-15');
    expect(parseQuickTask('dentist in a week').dueDate).toBe('2026-08-19');
    expect(parseQuickTask('dentist in 2 months').dueDate).toBe('2026-10-12');
  });

  it('явные даты в обоих порядках, порядковые допустимы', () => {
    expect(parseQuickTask('taxes June 15').dueDate).toBe('2027-06-15');
    expect(parseQuickTask('taxes 15 June').dueDate).toBe('2027-06-15');
    expect(parseQuickTask('taxes 15th June 2027').dueDate).toBe('2027-06-15');
    expect(parseQuickTask('taxes June 15, 2027').dueDate).toBe('2027-06-15');
    expect(parseQuickTask('meet Sep 5').dueDate).toBe('2026-09-05');
  });

  it('числовая дата — слэш, порядок день/месяц', () => {
    expect(parseQuickTask('meet 05/09').dueDate).toBe('2026-09-05');
    expect(parseQuickTask('meet 15/06/2027').dueDate).toBe('2027-06-15');
    const p = parseQuickTask('meet 31/02');
    expect(p.dueDate).toBeNull();
    expect(p.title).toBe('meet 31/02');
  });

  it('«run 1.5 km» — точка это десятичная, не дата', () => {
    const p = parseQuickTask('run 1.5 km');
    expect(p.dueDate).toBeNull();
    expect(p.title).toBe('run 1.5 km');
  });

  it('обыкновенные дроби размеров — не даты; «5/9» — дата', () => {
    const p = parseQuickTask('buy 1/2 inch screws');
    expect(p.dueDate).toBeNull();
    expect(p.title).toBe('buy 1/2 inch screws');
    expect(parseQuickTask('cut 3/4 inch pipe').dueDate).toBeNull();
    expect(parseQuickTask('meet 5/9').dueDate).toBe('2026-09-05');
  });

  it('запятая после даты и перед годом не мешает разбору', () => {
    const p = parseQuickTask('meet June 15, prep docs');
    expect(p.dueDate).toBe('2027-06-15');
    expect(p.title).toBe('meet prep docs');
    expect(parseQuickTask('taxes 15 June, 2027').dueDate).toBe('2027-06-15');
  });

  it('осознанный компромисс: «may 3» разбирается как 3 мая', () => {
    expect(parseQuickTask('review may 3 drafts').dueDate).toBe('2027-05-03');
  });

  it('дни недели: ближайший, тот же день — через неделю, сокращения с предлогом', () => {
    expect(parseQuickTask('gym on friday').dueDate).toBe('2026-08-14');
    expect(parseQuickTask('gym wednesday').dueDate).toBe('2026-08-19');
    expect(parseQuickTask('gym on fri').dueDate).toBe('2026-08-14');
    expect(parseQuickTask('gym this saturday').dueDate).toBe('2026-08-15');
  });

  it('голые сокращения дней — обычные английские слова, не даты', () => {
    const p = parseQuickTask('buy sun cream');
    expect(p.dueDate).toBeNull();
    expect(p.title).toBe('buy sun cream');
    expect(parseQuickTask('fix sat nav').title).toBe('fix sat nav');
    expect(parseQuickTask('wed the garden').dueDate).toBeNull();
  });

  it('next monday — понедельник следующей недели', () => {
    expect(parseQuickTask('sync next monday').dueDate).toBe('2026-08-17');
    expect(parseQuickTask('sync on next mon').dueDate).toBe('2026-08-17');
  });

  it('время: am/pm, двоеточие, noon и midnight', () => {
    expect(parseQuickTask('dinner at 6pm').dueTime).toBe('18:00');
    expect(parseQuickTask('dinner 6:30pm').dueTime).toBe('18:30');
    expect(parseQuickTask('taxi at 12am').dueTime).toBe('00:00');
    expect(parseQuickTask('lunch at noon').dueTime).toBe('12:00');
    expect(parseQuickTask('backup at midnight').dueTime).toBe('00:00');
    expect(parseQuickTask('call at 18:30').dueTime).toBe('18:30');
    expect(parseQuickTask('call at 9').dueTime).toBe('09:00');
  });

  it('«at 8 in the evening» — вечер, фраза вырезана целиком', () => {
    expect(parseQuickTask('dinner at 8 in the evening')).toMatchObject({
      dueTime: '20:00',
      title: 'dinner',
    });
    expect(parseQuickTask('walk at 7 this morning')).toMatchObject({
      dueTime: '07:00',
      title: 'walk',
    });
  });

  it('невалидное время не вырезается и не ставится — остаётся в заголовке', () => {
    const p = parseQuickTask('pay rent at 13pm');
    expect(p.dueTime).toBeNull();
    expect(p.title).toBe('pay rent at 13pm');
    expect(parseQuickTask('meet 99:30').title).toBe('meet 99:30');
    expect(parseQuickTask('meet 18:99').title).toBe('meet 18:99');
  });

  it('голые noon/midnight — существительные, время только с «at»', () => {
    const p = parseQuickTask('buy midnight snack');
    expect(p.dueTime).toBeNull();
    expect(p.title).toBe('buy midnight snack');
    expect(parseQuickTask('prep noon meeting').dueTime).toBeNull();
  });

  it('части дня — только предложные формы; «morning run» цел', () => {
    expect(parseQuickTask('walk in the morning')).toMatchObject({
      dueDate: '2026-08-12',
      dueTime: '09:00',
    });
    expect(parseQuickTask('walk tomorrow in the evening')).toMatchObject({
      dueDate: '2026-08-13',
      dueTime: '19:00',
    });
    expect(parseQuickTask('pills at night').dueTime).toBe('22:00');
    const p = parseQuickTask('morning run');
    expect(p.title).toBe('morning run');
    expect(p.dueDate).toBeNull();
  });

  it('tonight — сегодня вечером, явное время сильнее', () => {
    expect(parseQuickTask('movie tonight')).toMatchObject({
      dueDate: '2026-08-12',
      dueTime: '19:00',
    });
    expect(parseQuickTask('movie tonight at 11pm')).toMatchObject({
      dueDate: '2026-08-12',
      dueTime: '23:00',
    });
  });

  it('tonight поднимает неоднозначный час в вечер, явные am/pm — нет', () => {
    expect(parseQuickTask('movie tonight at 9').dueTime).toBe('21:00');
    expect(parseQuickTask('movie tonight at 9:30').dueTime).toBe('21:30');
    expect(parseQuickTask('call tonight at 9am').dueTime).toBe('09:00');
    expect(parseQuickTask('news tonight at 21:00').dueTime).toBe('21:00');
  });

  it('ввод из одних токенов: заголовком остаётся исходная строка', () => {
    expect(parseQuickTask('tomorrow').title).toBe('tomorrow');
  });

  it('приоритет и теги работают и в EN', () => {
    const p = parseQuickTask('milk !!! #home');
    expect(p.priority).toBe(3);
    expect(p.tags).toEqual(['home']);
    expect(p.title).toBe('milk');
  });

  it('русская грамматика в английском интерфейсе не работает', () => {
    expect(parseQuickTask('позвонить маме завтра').dueDate).toBeNull();
  });
});

describe('подсказка разбора (describeParsed)', () => {
  it('русская: дата, время, приоритет, теги через точку', () => {
    const hint = describeParsed(parseQuickTask('маме завтра в 10:00 ! #дом'));
    expect(hint).toBe('завтра · в 10:00 · !низкий · #дом');
  });

  it('английская: то же на языке интерфейса', () => {
    setLang('en');
    const hint = describeParsed(parseQuickTask('mom tomorrow at 10 ! #home'));
    expect(hint).toBe('tomorrow · at 10:00 · !low · #home');
  });

  it('нечего показать — null', () => {
    expect(describeParsed(parseQuickTask('просто текст'))).toBeNull();
  });
});
