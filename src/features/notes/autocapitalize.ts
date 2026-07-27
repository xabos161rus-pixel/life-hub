// Заглавная буква в начале строки и пункта списка.
//
// Клавиатура iOS капитализирует сама, но решает по пунктуации: заглавная идёт
// после точки. Внутри списка точек обычно нет — люди пишут пункты без них, —
// поэтому второй и все следующие пункты начинались со строчной, хотя каждый
// пункт это отдельное предложение. То же с новой строкой в теле заметки.
//
// Отсюда своя проверка: поднимаем регистр, только когда символ действительно
// ПЕРВЫЙ в своей строке. В середине слова или предложения не вмешиваемся
// никогда — иначе «и т.д.» превращалось бы в «И т.Д.».

/** Текст внутри блока ДО каретки. Пустая строка — каретка в самом начале. */
function textBeforeCaret(block: Element, sel: Selection): string {
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(block);
  range.setEnd(sel.anchorNode!, sel.anchorOffset);
  return range.toString();
}

/** Блок, которому принадлежит каретка: пункт списка, абзац, цитата, заголовок
 *  или сам редактор (первая строка заметки — голые текст-узлы в корне). */
function blockOf(node: Node | null, root: HTMLElement): Element | null {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || !root.contains(el)) return null;
  return el.closest('li, p, div, h1, h2, blockquote') ?? root;
}

/** Символ, который вот-вот введут, — строчная буква? Цифры, знаки и уже
 *  заглавные не трогаем. */
function isLowercaseLetter(s: string): boolean {
  if (s.length !== 1) return false;
  const up = s.toUpperCase();
  return up !== s && s.toLowerCase() === s;
}

/**
 * Поднимать ли регистр у вводимого символа.
 *
 * Отдельной чистой функцией, а не веткой внутри обработчика: правило про
 * «первый символ строки» легко ломается краевыми случаями (пробел перед
 * кареткой, пустой пункт, каретка в корне редактора), и его надо уметь
 * проверять тестами, не поднимая браузер.
 */
export function shouldCapitalize(
  root: HTMLElement,
  sel: Selection | null,
  data: string | null,
): boolean {
  if (!data || !isLowercaseLetter(data)) return false;
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false;
  const anchor = sel.anchorNode;
  if (!anchor || !root.contains(anchor)) return false;
  const block = blockOf(anchor, root);
  if (!block) return false;
  // Только начало строки. Пробелы игнорируем: отступ в начале пункта — всё ещё
  // начало пункта.
  return textBeforeCaret(block, sel).trim() === '';
}
