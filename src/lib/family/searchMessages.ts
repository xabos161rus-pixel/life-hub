// Поиск по переписке группы.
//
// Семья обменивается тем, что потом ищут: адрес, время встречи, номер заказа,
// «что купить». Без поиска это находится пролистыванием на неделю назад — то
// есть не находится вовсе.
//
// Ищем по базе, а не по загруженному в ленту окну: в ленте живёт последняя
// сотня сообщений, а нужное почти всегда старше.

import Dexie from 'dexie';
import { db } from '../../db/db';
import type { FamilyMessage } from '../../db/types';

/** Сколько находок отдаём. Больше полусотни всё равно не просматривают —
 *  уточняют запрос. */
const LIMIT = 50;

/** Сколько сообщений просматриваем вглубь истории. Год переписки семьи из
 *  четырёх человек — это тысячи сообщений; читать их все ради поиска значит
 *  поднять из базы и все вложения заодно. */
const DEPTH = 3000;

export interface SearchHit {
  message: FamilyMessage;
  /** Границы совпадения в тексте — для подсветки. */
  from: number;
  to: number;
}

/** Регистр не важен, «ё» и «е» считаем одной буквой: их путают при наборе. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

export async function searchMessages(familyId: string, query: string): Promise<SearchHit[]> {
  const needle = normalize(query.trim());
  if (needle.length < 2) return []; // по одной букве находится вся переписка

  const rows = await db.familyMessages
    .where('[familyId+seq]')
    .between([familyId, Dexie.minKey], [familyId, Dexie.maxKey])
    .reverse()
    .limit(DEPTH)
    .toArray();

  const hits: SearchHit[] = [];
  for (const m of rows) {
    if (m.deletedAt || m.reaction || m.fileChunk || m.system) continue;
    const text = m.text || m.file?.name || '';
    if (!text) continue;
    const at = normalize(text).indexOf(needle);
    if (at < 0) continue;
    hits.push({ message: m, from: at, to: at + needle.length });
    if (hits.length >= LIMIT) break;
  }
  return hits;
}
