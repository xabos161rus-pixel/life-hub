import { describe, expect, it } from 'vitest';
import { parseCsvLine, parseCycleCsv, parseDate, parseFlow } from './importCsv';

describe('разбор строки CSV', () => {
  it('поле с запятой внутри кавычек не разрывается', () => {
    // «Light, spotting» одной ячейкой — наивный split по запятой сдвинул бы
    // все колонки правее, и дата уехала бы в другое поле.
    expect(parseCsvLine('2026-01-01,"Light, spotting",ok', ',')).toEqual([
      '2026-01-01', 'Light, spotting', 'ok',
    ]);
  });

  it('удвоенные кавычки внутри поля', () => {
    expect(parseCsvLine('a,"он сказал ""да""",b', ',')).toEqual(['a', 'он сказал "да"', 'b']);
  });
});

describe('дата', () => {
  it('однозначные форматы разбираются', () => {
    expect(parseDate('2026-03-07')).toBe('2026-03-07');
    expect(parseDate('07.03.2026')).toBe('2026-03-07');
    expect(parseDate('2026/3/7')).toBe('2026-03-07');
  });

  it('неоднозначная 01/02/2026 НЕ разбирается', () => {
    // Это и 1 февраля, и 2 января. Угадать нельзя, а угадав неверно — сдвинуть
    // человеку половину истории на месяцы. Лучше честно не распознать.
    expect(parseDate('01/02/2026')).toBeNull();
  });

  it('мусор не превращается в дату', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('позавчера')).toBeNull();
  });
});

describe('уровень выделений', () => {
  it('слова на двух языках', () => {
    expect(parseFlow('Light')).toBe('light');
    expect(parseFlow('обильные')).toBe('heavy');
    expect(parseFlow('Spotting')).toBe('spotting');
    expect(parseFlow('Умеренные выделения')).toBe('medium');
  });

  it('числовая шкала', () => {
    expect(parseFlow('0')).toBe('none');
    expect(parseFlow('1')).toBe('light');
    expect(parseFlow('3')).toBe('heavy');
  });

  it('отметка без уровня считается обычной менструацией', () => {
    // Потерять сам факт дня хуже, чем не угадать обильность: день — главное,
    // ради чего историю и переносят.
    expect(parseFlow('yes')).toBe('medium');
    expect(parseFlow('да')).toBe('medium');
  });

  it('пустое и непонятное — не уровень', () => {
    expect(parseFlow('')).toBeNull();
    expect(parseFlow('головная боль')).toBeNull();
  });
});

describe('разбор выгрузки целиком', () => {
  it('английский заголовок с запятой-разделителем', () => {
    const csv = ['date,flow,notes', '2026-01-01,Heavy,', '2026-01-02,Medium,', '2026-01-03,Light,'].join('\n');
    const r = parseCycleCsv(csv);
    expect(r.days).toHaveLength(3);
    expect(r.dateColumn).toBe('date');
    expect(r.flowColumn).toBe('flow');
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-01-03');
  });

  it('русский заголовок с точкой с запятой', () => {
    // Европейская выгрузка: разделитель «;», а внутри полей встречаются
    // запятые. Разделитель определяется по числу колонок, а не угадыванием.
    const csv = ['Дата;Выделения;Симптомы', '01.02.2026;Обильные;спазмы, усталость', '02.02.2026;Умеренные;'].join('\n');
    const r = parseCycleCsv(csv);
    expect(r.days).toHaveLength(2);
    expect(r.days[0]).toEqual({ date: '2026-02-01', bleeding: 'heavy' });
  });

  it('повторы по дате: побеждает последняя запись', () => {
    const csv = ['date,flow', '2026-01-01,Light', '2026-01-01,Heavy'].join('\n');
    const r = parseCycleCsv(csv);
    expect(r.days).toEqual([{ date: '2026-01-01', bleeding: 'heavy' }]);
  });

  it('нераспознанное считается и показывается, а не теряется молча', () => {
    const csv = ['date,flow', '2026-01-01,Light', 'позавчера,Heavy', '2026-01-03,головная боль'].join('\n');
    const r = parseCycleCsv(csv);
    expect(r.rows).toBe(3);
    expect(r.days).toHaveLength(1);
    expect(r.skippedNoDate).toBe(1);
    expect(r.skippedNoFlow).toBe(1);
  });

  it('без колонки выделений уровень ищется по остальным ячейкам', () => {
    // Часть выгрузок кладёт всё отмеченное за день в одну колонку.
    const csv = ['Дата;Отметки', '01.03.2026;Обильные'].join('\n');
    const r = parseCycleCsv(csv);
    expect(r.days).toEqual([{ date: '2026-03-01', bleeding: 'heavy' }]);
  });

  it('файл без даты не импортируется', () => {
    const r = parseCycleCsv(['вес;настроение', '60;хорошее'].join('\n'));
    expect(r.days).toHaveLength(0);
    expect(r.dateColumn).toBeNull();
  });

  it('пустой файл не роняет разбор', () => {
    expect(parseCycleCsv('').days).toHaveLength(0);
    expect(parseCycleCsv('date,flow').days).toHaveLength(0);
  });
});
