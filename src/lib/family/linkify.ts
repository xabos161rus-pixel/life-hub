// Разбор текста сообщения на обычные куски и ссылки.
//
// Присланная в чат ссылка была мёртвым текстом: нажать нельзя, выделить
// частично нельзя (жесты пузыря перехватывают касание), оставалось
// переписывать руками. Для семьи, которая кидает друг другу адреса и
// ссылки на товары, это раздражало каждый раз.
//
// Разбор чистый и без зависимостей: регулярное выражение, а не парсер
// разметки — в чате нет ни жирного, ни курсива, только текст и ссылки.

export type TextPart =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string };

// http(s) и голые домены вида example.com/путь. Хвостовая пунктуация
// («зайди на example.com.») в ссылку не входит — иначе адрес ломается.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>()]+|[a-zа-я0-9][a-zа-я0-9-]*\.(?:ru|com|org|net|io|рф|dev|app|me|tv)(?:\/[^\s<>()]*)?)/gi;
const TRAILING = /[.,;:!?»)\]]+$/;

/** Режет текст на части. Обычный текст возвращается одним куском —
 *  сообщение без ссылок не платит за эту функцию ничем. */
export function linkify(text: string): TextPart[] {
  if (!text || !/[.:]/.test(text)) return [{ kind: 'text', value: text }];
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let raw = m[0];
    const tail = TRAILING.exec(raw)?.[0] ?? '';
    if (tail) raw = raw.slice(0, -tail.length);
    if (!raw) continue;
    if (start > last) parts.push({ kind: 'text', value: text.slice(last, start) });
    parts.push({
      kind: 'link',
      value: raw,
      // Без схемы браузер трактует адрес как относительный путь и уводит
      // внутрь приложения — дописываем https.
      href: /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
    });
    last = start + raw.length;
  }
  if (last === 0) return [{ kind: 'text', value: text }];
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
}
