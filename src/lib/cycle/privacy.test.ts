// Инвариант приватности раздела «Женские дни».
//
// Тест намеренно читает исходники, а не поведение: проверять поведение здесь
// бесполезно — утечка появится не от того, что код работает неправильно, а от
// того, что кто-то (в том числе я в следующей задаче) добавит таблицу в
// allowlist «чтобы синхронизировалось как всё остальное». Падающий тест в этот
// момент — единственное, что об этом скажет.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(resolve(here, '../../', p), 'utf8');

/** Тот же файл без комментариев: иначе проверки ловят слова из объяснений,
 *  которые как раз и рассказывают, почему так делать нельзя. */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const CYCLE_TABLES = [
  'cycleDays',
  'cycles',
  'cycleOverrides',
  'cycleEpisodes',
  'cycleSettings',
  'cycleSymptoms',
  'cyclePredictions',
];

describe('данные цикла не покидают устройство', () => {
  it('ни одна таблица раздела не входит в список синхронизируемых', () => {
    const sync = src('lib/sync.ts');
    const list = sync.slice(sync.indexOf('const SYNCED_TABLES'), sync.indexOf('] as const'));
    for (const t of CYCLE_TABLES) {
      expect(list, `таблица ${t} попала в SYNCED_TABLES`).not.toContain(`'${t}'`);
    }
  });

  it('семейный транспорт не знает о таблицах раздела', () => {
    for (const file of ['lib/family/familyRepo.ts', 'lib/family/familyChat.ts']) {
      const body = code(file);
      for (const t of CYCLE_TABLES) {
        expect(body, `${file} обращается к ${t}`).not.toContain(`db.${t}`);
      }
    }
  });

  it('репозиторий раздела не вызывает планировщик синхронизации', () => {
    const repo = code('lib/cycle/cycleRepo.ts');
    expect(repo).not.toContain('scheduleSyncSoon');
    // Общий репозиторий дёргает синк на каждой записи — значит писать через
    // него данные цикла нельзя, даже «одним вызовом для удобства».
    expect(repo).not.toMatch(/from '\.\.\/\.\.\/db\/repo'/);
  });

  it('настройки раздела по умолчанию закрыты', () => {
    const repo = src('lib/cycle/cycleRepo.ts');
    const block = repo.slice(
      repo.indexOf('DEFAULT_CYCLE_SETTINGS'),
      repo.indexOf('/** Заводит настройки'),
    );
    expect(block).toContain('syncEnabled: false');
    expect(block).toContain('includeInGeneralBackup: false');
    expect(block).toContain('showOnTodayScreen: false');
    expect(block).toContain("fertilityDisplay: 'off'");
    // Все связки с другими разделами выключены: связка полезна тому, кто её
    // включил, и навязчива всем остальным.
    const integrations = block.slice(block.indexOf('integrations'));
    expect(integrations).not.toMatch(/:\s*true/);
  });
});
