import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Bold, Italic, List, ListOrdered, Pin, SlidersHorizontal, Trash2, Type } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Screen } from '../../components/layout/Screen';
import { MicButton } from '../../components/ui/MicButton';
import { Hint } from '../../components/ui/Hint';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';

const AUTOSAVE_MS = 600;

// Содержимое — это HTML из contentEditable. Чистим перед записью: заметки
// свои, не импортированные, но санитайз защищает от вставленного из буфера.
const SANITIZE = {
  ALLOWED_TAGS: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'span'],
  ALLOWED_ATTR: [],
};

/** Заголовок заметки = первая непустая строка её текста (как в iOS).
 *  Без жёсткого лимита: режем лишь на 300 символов — защита от «заголовка» в
 *  абзац, но обычные длинные названия сохраняются целиком. */
function deriveTitle(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) return t.slice(0, 300);
  }
  return '';
}

function ToolBtn({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      // не отдаём фокус из редактора — иначе пропадёт выделение
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex size-10 items-center justify-center rounded-xl transition-colors ${
        active ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-text active:bg-elevated'
      }`}
    >
      {children}
    </button>
  );
}

export function NoteEditorPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = routeId === 'new';

  const editorRef = useRef<HTMLDivElement>(null);
  const savedIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const deletedRef = useRef(false);
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pinnedRef = useRef(false);
  const savingRef = useRef(false);

  const [pinned, setPinned] = useState(false);
  const [saved, setSaved] = useState(false);
  // Активность кнопок форматирования для подсветки в тулбаре.
  const [active, setActive] = useState({ bold: false, italic: false, ul: false, ol: false });

  // Пересчитываем активные форматы по текущему выделению (в обработчике, не в
  // рендере). Тротл: selectionchange стреляет на каждый символ, а 4 вызова
  // queryCommandState на iOS дороги — на длинной заметке подвешивали ввод.
  const activeThrottle = useRef(0);
  const syncActive = useCallback(() => {
    const now = Date.now();
    if (now - activeThrottle.current < 200) return;
    activeThrottle.current = now;
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
    setActive({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      ul: document.queryCommandState('insertUnorderedList'),
      ol: document.queryCommandState('insertOrderedList'),
    });
  }, []);

  // Подсветка следует за курсором/выделением, пока редактор открыт.
  useEffect(() => {
    document.addEventListener('selectionchange', syncActive);
    return () => document.removeEventListener('selectionchange', syncActive);
  }, [syncActive]);

  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);

  // Одноразовая загрузка в редактор: live-binding вреден — автосейв перетёр бы
  // поле под руками. Удалённую по URL заметку трактуем как ненайденную.
  useEffect(() => {
    if (isNew) {
      editorRef.current?.focus();
      return;
    }
    if (!routeId || initializedRef.current || savedIdRef.current) return;
    let cancelled = false;
    void db.notes.get(routeId).then((n) => {
      if (cancelled || !n || n.deletedAt || initializedRef.current) return;
      initializedRef.current = true;
      savedIdRef.current = n.id;
      setPinned(n.pinned);
      if (editorRef.current) {
        const raw = n.content || '';
        // Заметки v1 хранили markdown, новый редактор работает с HTML. Старый
        // контент (без HTML-тегов) конвертируем в HTML и помечаем dirty — он
        // один раз пересохранится в новом формате, а не сломается при правке.
        const looksHtml = /<\/?[a-z][^>]*>/i.test(raw);
        if (looksHtml || !raw) {
          editorRef.current.innerHTML = raw;
        } else {
          editorRef.current.innerHTML = DOMPurify.sanitize(
            marked.parse(raw, { async: false }) as string,
            SANITIZE,
          );
          dirtyRef.current = true;
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [routeId, isNew]);

  const flush = useCallback(async () => {
    const el = editorRef.current;
    if (deletedRef.current || !dirtyRef.current || !el || savingRef.current) return;
    dirtyRef.current = false;
    savingRef.current = true; // in-flight guard: не создаём дубль новой заметки
    try {
      const html = DOMPurify.sanitize(el.innerHTML, SANITIZE);
      const plain = (el.innerText ?? '').trim();
      const title = deriveTitle(el.innerText ?? '');
      if (savedIdRef.current) {
        await update(db.notes, savedIdRef.current, {
          title,
          content: html,
          pinned: pinnedRef.current,
        });
      } else if (plain) {
        // Пустую новую заметку не сохраняем (как в iOS).
        const created = await create(db.notes, {
          title,
          content: html,
          tags: [],
          pinned: pinnedRef.current,
        });
        savedIdRef.current = created.id;
        navigate(`/notes/${created.id}`, { replace: true });
      }
      setSaved(true);
    } finally {
      savingRef.current = false;
    }
  }, [navigate]);

  const touch = useCallback(() => {
    dirtyRef.current = true;
    setSaved(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  const toolbarRef = useRef<HTMLDivElement>(null);

  // «Камера» следует за текстом: при наборе курсор уезжает под клавиатуру /
  // панель форматирования, а контейнер сам не скроллится — докручиваем
  // #app-scroll так, чтобы каретка оставалась в видимой зоне.
  const keepCaretVisible = useCallback(() => {
    requestAnimationFrame(() => {
      const scroller = document.getElementById('app-scroll');
      const el = editorRef.current;
      const sel = document.getSelection();
      if (!scroller || !el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(false);
      let rect = range.getBoundingClientRect();
      if (rect.height === 0 && rect.width === 0) {
        // Пустая строка: у схлопнутого range нет геометрии — берём её у блока строки.
        const node = sel.anchorNode;
        const near = node instanceof Element ? node : node?.parentElement;
        if (!near) return;
        rect = near.getBoundingClientRect();
      }
      // Видимая зона: visualViewport учитывает клавиатуру iOS; снизу вычитаем
      // панель форматирования (если она выше края вьюпорта), сверху — шапку.
      const vv = window.visualViewport;
      const vvBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const toolbarTop = toolbarRef.current?.getBoundingClientRect().top ?? Infinity;
      const bottom = Math.min(vvBottom, toolbarTop) - 12;
      const top = (vv?.offsetTop ?? 0) + 108;
      if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom;
      else if (rect.top < top) scroller.scrollTop -= top - rect.top;
    });
  }, []);

  // Автонумерация как в задачах: Enter после строки «N. текст» начинает новую
  // с «N+1. »; Enter на пустом пункте «N. » убирает маркер (выход из списка).
  // Настоящие <ol>/<ul> (кнопка в тулбаре) браузер продолжает сам — не трогаем.
  const handleEditorKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) {
      if (e.key === 'Enter') keepCaretVisible();
      return;
    }
    const el = editorRef.current;
    const sel = document.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return;
    const anchor = sel.anchorNode;
    if (!anchor || !el.contains(anchor)) return;
    // Каретка «между блоками» (anchorNode — сам редактор): iOS так ставит её
    // после Enter на пустой строке. Автонумерации тут нет — обычный перенос.
    if (anchor === el) {
      keepCaretVisible();
      return;
    }
    const host = anchor instanceof Element ? anchor : anchor.parentElement;
    if (host?.closest('li')) {
      keepCaretVisible();
      return; // внутри настоящего списка нумерацию ведёт браузер
    }
    // Блок текущей строки — ближайший предок, чей родитель сам редактор
    // (строки contentEditable — это <div>; первая строка — голые текст-узлы).
    // КРИТИЧНО не выйти за пределы редактора: range шире него превратил бы
    // «стирание маркера» в удаление куска страницы (мёртвый UI до перезагрузки).
    let block: Node = anchor;
    while (block.parentNode !== el) {
      if (!block.parentNode) {
        keepCaretVisible();
        return; // структура неожиданная — не трогаем DOM
      }
      block = block.parentNode;
    }
    const r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(anchor, sel.anchorOffset);
    const line = r.toString();
    const m = /^(\d+)\.\s(.*)$/.exec(line);
    if (!m) {
      keepCaretVisible();
      return; // строка не вида «N. …» — обычный перенос
    }
    e.preventDefault();
    const [, numStr, rest] = m;
    if (rest.trim() === '') {
      // Пустой пункт — стираем маркер и остаёмся на строке.
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('delete');
    } else {
      document.execCommand('insertParagraph');
      document.execCommand('insertText', false, `${Number(numStr) + 1}. `);
    }
    touch();
    keepCaretVisible();
  };

  // Сохранение при уходе со страницы.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      void flush();
    },
    [flush],
  );

  // Голосовой ввод: дописываем распознанный текст в конец заметки и
  // запускаем тот же автосейв, что и обычный набор (touch → flush).
  const appendVoice = useCallback(
    (text: string) => {
      const el = editorRef.current;
      if (!el) return;
      const existing = (el.innerText ?? '').trim();
      el.appendChild(document.createTextNode((existing ? ' ' : '') + text));
      touch();
    },
    [touch],
  );

  const exec = (command: string) => {
    // тег-based разметка (<b>/<i>), иначе на Gecko execCommand даёт
    // <span style> и наш санитайзер срезал бы форматирование
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command);
    editorRef.current?.focus();
    syncActive();
    touch();
  };

  const togglePin = () => {
    setPinned((p) => !p);
    touch();
  };

  const handleDelete = async () => {
    if (!window.confirm('Удалить заметку?')) return;
    deletedRef.current = true;
    clearTimeout(timerRef.current);
    if (savedIdRef.current) await remove(db.notes, savedIdRef.current);
    navigate('/notes');
  };

  // «Готово»: гасим отложенный автосейв, сохраняем текущее состояние и уходим.
  const handleDone = async () => {
    clearTimeout(timerRef.current);
    await flush();
    navigate('/notes');
  };

  return (
    <Screen
      title="Заметка"
      backTo="/notes"
      right={
        <div className="flex items-center gap-1">
          <MicButton onText={appendVoice} />
          <button
            onClick={togglePin}
            aria-label={pinned ? 'Открепить' : 'Закрепить'}
            className={`p-2 ${pinned ? 'text-accent' : 'text-muted'}`}
          >
            <Pin size={20} fill={pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => void handleDelete()}
            aria-label="Удалить"
            className="p-2 text-danger"
          >
            <Trash2 size={20} />
          </button>
          <button
            onClick={() => void handleDone()}
            className="pl-1 pr-1 font-semibold text-accent active:opacity-60"
          >
            Готово
          </button>
        </div>
      }
    >
      <Hint
        id="note-editor-tricks"
        title="Редактор заметок"
        className="mb-3"
        items={[
          { icon: Type, text: <>Первая строка — заголовок заметки</> },
          { icon: ListOrdered, text: <>Начните строку с «1. » — Enter продолжит нумерацию сам</> },
          { icon: SlidersHorizontal, text: <>Панель внизу — форматирование и списки</> },
        ]}
      />

      <div
        ref={editorRef}
        className="note-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Заголовок"
        onPaste={(e) => {
          // Чистим вставку ДО попадания в DOM: иначе <img onerror>/скрипт из
          // буфера может сработать раньше санитайза-на-сохранении (XSS).
          e.preventDefault();
          const html = e.clipboardData.getData('text/html');
          const text = e.clipboardData.getData('text/plain');
          const clean = html ? DOMPurify.sanitize(html, SANITIZE) : text;
          document.execCommand('insertHTML', false, clean);
          touch();
        }}
        onKeyDown={handleEditorKeyDown}
        onInput={() => {
          touch();
          keepCaretVisible();
        }}
        onBlur={() => {
          clearTimeout(timerRef.current);
          void flush();
        }}
      />

      {/* Панель форматирования над клавиатурой (таб-бар на этом экране скрыт). */}
      <div
        ref={toolbarRef}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface p-2 pb-[calc(env(safe-area-inset-bottom)+8px)]"
      >
        <div className="mx-auto flex w-full max-w-lg items-center gap-1">
        <ToolBtn onClick={() => exec('bold')} label="Жирный" active={active.bold}>
          <Bold size={20} strokeWidth={2.25} />
        </ToolBtn>
        <ToolBtn onClick={() => exec('italic')} label="Курсив" active={active.italic}>
          <Italic size={20} strokeWidth={2.25} />
        </ToolBtn>
        <ToolBtn onClick={() => exec('insertUnorderedList')} label="Маркированный список" active={active.ul}>
          <List size={20} strokeWidth={2.25} />
        </ToolBtn>
        <ToolBtn onClick={() => exec('insertOrderedList')} label="Нумерованный список" active={active.ol}>
          <ListOrdered size={20} strokeWidth={2.25} />
        </ToolBtn>
        <span
          className={`ml-auto pr-1.5 text-xs font-medium text-muted transition-opacity ${
            saved ? 'opacity-100' : 'opacity-0'
          }`}
        >
          Сохранено
        </span>
        </div>
      </div>
    </Screen>
  );
}
