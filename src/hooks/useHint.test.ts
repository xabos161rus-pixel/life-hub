import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HINT_IDS } from './useHint';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Все идентификаторы подсказок, реально расставленные по экранам. */
function idsInCode(): string[] {
  const found = new Set<string>();
  for (const file of walk(SRC)) {
    const code = readFileSync(file, 'utf8');
    // Ищем <Hint ... id="..."> и useHint('...'): подсказка попадает на экран
    // либо компонентом, либо хуком напрямую.
    for (const m of code.matchAll(/<Hint\b[^>]*?\sid="([^"]+)"/gs)) found.add(m[1]);
    for (const m of code.matchAll(/useHint\(\s*'([^']+)'/g)) found.add(m[1]);
  }
  return [...found].sort();
}

describe('реестр подсказок', () => {
  it('совпадает с тем, что расставлено по экранам', () => {
    // Счётчик «скрыто 3 из 5» в настройках считает по HINT_IDS. Если список
    // разойдётся с кодом — счётчик начнёт врать, и заметить это без теста
    // невозможно: цифра выглядит правдоподобно в любом случае.
    expect([...HINT_IDS].sort()).toEqual(idsInCode());
  });

  it('без дублей', () => {
    expect(new Set(HINT_IDS).size).toBe(HINT_IDS.length);
  });
});
