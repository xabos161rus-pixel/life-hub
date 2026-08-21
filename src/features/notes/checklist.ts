// Чек-лист внутри заметки.
//
// Список дел — то, ради чего заметку заводят чаще всего после простого текста,
// и в приложениях-конкурентах он есть везде. Здесь его не было вовсе.
//
// Реализация поверх обычного <ul>, а не через <input type="checkbox">:
// contenteditable и настоящие поля ввода уживаются плохо — каретка проваливается
// в чекбокс, Enter ведёт себя непредсказуемо, а копирование в буфер выносит
// разметку формы. Поэтому пункт — обычный <li>, состояние живёт в атрибуте, а
// галочку рисует CSS. В буфер такой список уезжает читаемым текстом.

/** Класс-маркер списка-чеклиста. */
export const CHECKLIST_CLASS = 'cl';
/** Атрибут состояния пункта. Строка '1' — сделано; IndexedDB тут ни при чём,
 *  это DOM, но булев атрибут в HTML всё равно пришлось бы кодировать строкой. */
export const DONE_ATTR = 'data-done';

/** Ближайший пункт чек-листа к узлу, если он вообще внутри чек-листа. */
export function closestChecklistItem(node: Node | null): HTMLLIElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  const li = el?.closest('li');
  if (!li) return null;
  return li.parentElement?.classList.contains(CHECKLIST_CLASS) ? (li as HTMLLIElement) : null;
}

/** Переключить пункт. */
export function toggleItem(li: HTMLLIElement): void {
  const done = li.getAttribute(DONE_ATTR) === '1';
  if (done) li.removeAttribute(DONE_ATTR);
  else li.setAttribute(DONE_ATTR, '1');
}

/** Попал ли тап в зону галочки — левый край пункта.
 *
 *  Зона шириной 34px: меньше не попасть пальцем, больше — начнёт перехватывать
 *  тапы по тексту, а человек в этот момент хочет поставить каретку. */
export function hitCheckbox(li: HTMLLIElement, clientX: number): boolean {
  const r = li.getBoundingClientRect();
  return clientX - r.left <= 34;
}

/** Превратить текущую строку в чек-лист или обратно.
 *
 *  Через document.execCommand('insertUnorderedList'), а не ручной сборкой DOM:
 *  браузер сам разберётся с выделением на несколько строк, вложенностью и
 *  положением каретки. Нам остаётся пометить получившийся список своим классом. */
export function toggleChecklist(root: HTMLElement): void {
  const sel = document.getSelection();
  const anchor = sel?.anchorNode ?? null;
  const existing = closestChecklistItem(anchor);
  if (existing) {
    // Уже чек-лист — разворачиваем обратно в обычные строки.
    document.execCommand('insertUnorderedList');
    return;
  }
  const inPlainList = (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('ul, ol');
  if (inPlainList) {
    // Обычный список превращаем в чек-лист на месте: снимать и ставить заново
    // значило бы потерять пункты.
    inPlainList.classList.add(CHECKLIST_CLASS);
    return;
  }
  document.execCommand('insertUnorderedList');
  const li = closestChecklistItem(document.getSelection()?.anchorNode ?? null);
  const list = li?.parentElement ?? (anchor instanceof Element ? anchor : anchor?.parentElement)?.closest('ul');
  if (list) list.classList.add(CHECKLIST_CLASS);
  else {
    // Списка не нашли — значит браузер вставил его глубже; берём последний в корне.
    const lists = root.querySelectorAll('ul:not(.' + CHECKLIST_CLASS + ')');
    lists[lists.length - 1]?.classList.add(CHECKLIST_CLASS);
  }
}

/** Сколько пунктов сделано и сколько всего — для превью в списке заметок.
 *
 *  html может не быть вовсе: запись приезжает синком с устройства другой
 *  версии или из восстановленной копии. Падение здесь означало бы пустой
 *  экран вместо всего списка заметок. */
export function checklistProgress(html: string | null | undefined): { done: number; total: number } | null {
  if (!html?.includes(CHECKLIST_CLASS)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = doc.querySelectorAll(`ul.${CHECKLIST_CLASS} > li`);
  if (items.length === 0) return null;
  let done = 0;
  for (const li of items) if (li.getAttribute(DONE_ATTR) === '1') done++;
  return { done, total: items.length };
}
