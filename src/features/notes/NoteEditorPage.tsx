import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { Bold, Italic, List, ListOrdered, Pin, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Screen } from '../../components/layout/Screen';
import { MicButton } from '../../components/ui/MicButton';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';

const AUTOSAVE_MS = 600;

// Содержимое — это HTML из contentEditable. Чистим перед записью: заметки
// свои, не импортированные, но санитайз защищает от вставленного из буфера.
const SANITIZE = {
  ALLOWED_TAGS: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'span'],
  ALLOWED_ATTR: [],
};

/** Заголовок заметки = первая непустая строка её текста (как в iOS). */
function deriveTitle(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) return t.slice(0, 140);
  }
  return '';
}

function ToolBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // не отдаём фокус из редактора — иначе пропадёт выделение
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-lg text-text active:bg-surface-2"
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
        </div>
      }
    >
      <div
        ref={editorRef}
        className="note-editor"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Заголовок"
        onInput={touch}
        onBlur={() => {
          clearTimeout(timerRef.current);
          void flush();
        }}
      />

      {/* Панель форматирования над клавиатурой (таб-бар на этом экране скрыт). */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-1 border-t border-border bg-surface/95 px-2 pt-1 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ToolBtn onClick={() => exec('bold')} label="Жирный">
          <Bold size={19} />
        </ToolBtn>
        <ToolBtn onClick={() => exec('italic')} label="Курсив">
          <Italic size={19} />
        </ToolBtn>
        <ToolBtn onClick={() => exec('insertUnorderedList')} label="Маркированный список">
          <List size={19} />
        </ToolBtn>
        <ToolBtn onClick={() => exec('insertOrderedList')} label="Нумерованный список">
          <ListOrdered size={19} />
        </ToolBtn>
        <span
          className={`ml-auto pr-2 text-xs text-muted transition-opacity ${
            saved ? 'opacity-100' : 'opacity-0'
          }`}
        >
          Сохранено
        </span>
      </div>
    </Screen>
  );
}
