// Ссылки в сообщениях: что должно стать кликабельным, а что — остаться текстом.

import { describe, expect, it } from 'vitest';
import { linkify } from './linkify';

const links = (s: string) => linkify(s).filter((p) => p.kind === 'link');

describe('разбор ссылок в сообщении', () => {
  it('обычный текст остаётся одним куском', () => {
    const parts = linkify('Привет, купи молока и хлеба');
    expect(parts).toHaveLength(1);
    expect(parts[0].kind).toBe('text');
  });

  it('полный адрес становится ссылкой', () => {
    const [l] = links('Смотри https://avito.ru/item/123 — вот это');
    expect(l.value).toBe('https://avito.ru/item/123');
    expect(l.href).toBe('https://avito.ru/item/123');
  });

  it('адрес без схемы получает https, иначе браузер уводит внутрь приложения', () => {
    const [l] = links('зайди на ozon.ru/product/5');
    expect(l.value).toBe('ozon.ru/product/5');
    expect(l.href).toBe('https://ozon.ru/product/5');
  });

  it('точка в конце предложения не съедается ссылкой', () => {
    const [l] = links('он тут: example.com.');
    expect(l.value).toBe('example.com');
    // И точка осталась в тексте — предложение не потеряло знак.
    expect(linkify('он тут: example.com.').at(-1)).toMatchObject({ kind: 'text', value: '.' });
  });

  it('несколько ссылок в одном сообщении', () => {
    expect(links('первая ya.ru и вторая https://ok.ru/x')).toHaveLength(2);
  });

  it('текст с точкой, но без адреса, ссылкой не становится', () => {
    expect(links('Купил хлеб. Молоко тоже.')).toHaveLength(0);
    expect(links('цена 1.5 кг')).toHaveLength(0);
  });

  it('русский домен тоже узнаётся', () => {
    const [l] = links('смотри на сайт-магазин.рф/акции');
    expect(l.href).toContain('сайт-магазин.рф');
  });
});
