// Расшифровка пачки входящих записей с одной попыткой обновить ключ.
//
// Ключ группы меняется, когда кого-то исключают. Устройство, которое в этот
// момент было закрыто, конверт с новым ключом не получает — и всё, что
// написали после, приходит нечитаемым. Раньше такие записи молча
// выбрасывались: в переписке оставалась дыра, о которой человек не узнавал.
//
// Свой запечатанный ключ лежит на сервере, поэтому первая же неудача — повод
// сходить за ним и попробовать ещё раз. Живёт отдельно от движка чата: здесь
// нет ни сети, ни сокетов, только крипто и решение «попробовать ещё раз».

import type { FamilyConfig } from '../../db/types';
import { decFamily } from './familyKeys';

export interface DecryptResult<I> {
  /** Что удалось прочитать — в исходном порядке. */
  decoded: { it: I; p: Record<string, unknown> }[];
  /** Что не поддалось даже после обновления ключа. */
  failed: I[];
  /** Конфиг: тот же или обновлённый, если ключ пришлось забрать заново. */
  config: FamilyConfig;
}

/**
 * @param recover забирает свой ключ с сервера. Возвращает новый конфиг или
 *   null, если брать нечего (нет сети, нет конверта, недавно уже пробовали).
 */
export async function decryptBatch<I extends { ciphertext: string }>(
  config: FamilyConfig,
  items: I[],
  recover: () => Promise<FamilyConfig | null>,
): Promise<DecryptResult<I>> {
  const decoded: { it: I; p: Record<string, unknown> }[] = [];
  const failed: I[] = [];

  for (const it of items) {
    try {
      decoded.push({ it, p: await decFamily<Record<string, unknown>>(config, it.ciphertext) });
    } catch {
      failed.push(it);
    }
  }

  if (failed.length === 0) return { decoded, failed, config };

  const fresh = await recover();
  if (!fresh) return { decoded, failed, config };

  const stillFailed: I[] = [];
  for (const it of failed) {
    try {
      decoded.push({ it, p: await decFamily<Record<string, unknown>>(fresh, it.ciphertext) });
    } catch {
      stillFailed.push(it);
    }
  }
  // Порядок: после второго захода дочитанное лежит в конце. Восстанавливаем
  // исходный — на нём держится последовательность событий в ленте.
  decoded.sort((a, b) => items.indexOf(a.it) - items.indexOf(b.it));
  return { decoded, failed: stillFailed, config: fresh };
}
