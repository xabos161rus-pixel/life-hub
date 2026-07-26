// Работа со структурой contenteditable в редакторе заметок.
//
// Заметка — один редактируемый блок, а не «поле заголовка + поле текста».
// Заголовок здесь — это ведущий «голый» текст до первого блочного тега: стиль
// заголовка задаёт база .note-editor, а любой блок (div/p/ul/…) сбрасывает его
// до обычного (см. index.css).
//
// Пока человек набирает руками, инвариант держится сам: браузер оставляет
// первую строку текстовым узлом и оборачивает в <div> только следующие. Но
// вставка из буфера приносит готовую разметку, и первая строка приезжает уже
// внутри <div> или <p> — заголовок молча превращался в обычный текст. Из
// мессенджера, где в буфере только plain text, всё было хорошо; из браузера,
// Word или редактора документов — нет.

/** Блоки, которые могут оказаться ведущими и «съесть» заголовок. Списки и
 *  готовые h1/h2 не трогаем: если заметка начинается со списка, значит
 *  заголовка у неё нет, и выдумывать его не надо. */
const UNWRAPPABLE = new Set(['DIV', 'P']);

/** Смещение каретки в тексте корня — чтобы пережить перестройку DOM.
 *  Считается по видимому тексту, без переводов строк между блоками: ровно так
 *  же его потом восстанавливает setCaretAtOffset. */
export function caretOffset(root: HTMLElement): number | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !root.contains(sel.anchorNode)) {
    return null;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(sel.anchorNode, sel.anchorOffset);
  return range.toString().length;
}

/** Поставить каретку на смещение в тексте. Если содержимое короче — в конец. */
export function setCaretAtOffset(root: HTMLElement, offset: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let node: Node | null;
  const sel = document.getSelection();
  if (!sel) return;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (acc + len >= offset) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, offset - acc));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    acc += len;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Развернуть ведущий блок, чтобы первая строка снова стала заголовком.
 *
 *  Возвращает true, если структура изменилась — вызывающему это нужно, чтобы
 *  не дёргать сохранение впустую.
 *
 *  Разворачиваем только «простой» ведущий блок: если внутри него своя
 *  структура (вложенные абзацы, список), это не одна строка, и вытаскивать её
 *  наружу значило бы ломать вставленный документ. */
export function unwrapLeadingBlock(root: HTMLElement): boolean {
  const first = root.firstChild;
  if (!first || first.nodeType !== Node.ELEMENT_NODE) return false;
  const block = first as HTMLElement;
  if (!UNWRAPPABLE.has(block.tagName)) return false;
  if (block.querySelector('div, p, ul, ol, li, h1, h2, blockquote, pre')) return false;

  // Пустой ведущий блок — это пустая первая строка. Разворачивать нечего, но и
  // оставлять нельзя: заголовок оказался бы во второй строке. Просто убираем.
  if (!block.textContent?.trim() && !block.querySelector('br, img')) {
    block.remove();
    return true;
  }
  const frag = document.createDocumentFragment();
  while (block.firstChild) frag.appendChild(block.firstChild);
  // Разделитель между заголовком и телом: без него следующий блок прилипнет к
  // заголовку и станет его частью при следующем развороте.
  root.replaceChild(frag, block);
  return true;
}

/** Привести структуру к инварианту, сохранив позицию каретки. */
export function normalizeEditor(root: HTMLElement): boolean {
  const offset = caretOffset(root);
  const changed = unwrapLeadingBlock(root);
  if (changed && offset !== null) setCaretAtOffset(root, offset);
  return changed;
}
