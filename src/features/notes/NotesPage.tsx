import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pin, Search, NotebookText } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchField } from '../../components/ui/Input';
import { db } from '../../db/db';
import { alive, remove } from '../../db/repo';
import type { Note } from '../../db/types';
import { formatRu, toKey } from '../../lib/dates';

/** HTML заметки → плоский текст для превью/поиска (с переносами на блоках). */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\/?(?:div|p|li|h1|h2|ul|ol|blockquote)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  // Все HTML-сущности декодируем корректно через textarea (а не вручную).
  const ta = document.createElement('textarea');
  ta.innerHTML = withBreaks;
  return ta.value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Строка заметки со свайпом влево для удаления (pointer events — тач и мышь). */
function NoteRow({
  note,
  onOpen,
  onDelete,
}: {
  note: Note;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ x: 0, dx: 0, moved: false });

  const text = useMemo(() => htmlToText(note.content), [note.content]);
  const title = note.title || text.split('\n')[0] || 'Без названия';
  const preview = text.split('\n').slice(1).join(' ').trim();

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, dx, moved: false };
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    const d = e.clientX - drag.current.x;
    if (Math.abs(d) > 6) drag.current.moved = true;
    setDx(Math.max(-88, Math.min(0, drag.current.dx + d)));
  };
  const onUp = () => {
    setDragging(false);
    setDx((cur) => (cur < -44 ? -88 : 0));
  };
  const onClick = () => {
    if (drag.current.moved) return; // это был свайп, не тап
    if (dx !== 0) {
      setDx(0); // открыт — закрываем
      return;
    }
    onOpen();
  };

  return (
    <div className="relative overflow-hidden rounded-[1.15rem] shadow-[var(--shadow-card)]">
      {/* Кнопку рендерим ТОЛЬКО при свайпе. В покое (dx=0) её нет в DOM —
          значит ничему просвечивать в скруглённых углах карточки (на iOS
          overflow:hidden не клипает строку с transform, и красный угол торчал
          постоянно). */}
      {dx < 0 && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center rounded-r-[1.15rem] bg-danger text-sm font-medium text-white"
        >
          Удалить
        </button>
      )}
      <div
        className="relative flex touch-pan-y items-start gap-2 rounded-[1.15rem] border border-hairline bg-surface p-3.5"
        style={{
          // transform только во время свайпа: translateX(0px) в покое сам по
          // себе ломал обрезку по скруглению на WebKit.
          transform: dx !== 0 ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform 0.2s',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={onClick}
      >
        {note.pinned && <Pin size={13} className="mt-1 shrink-0 text-accent" fill="currentColor" />}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words font-semibold">{title}</p>
          <p className="mt-0.5 flex gap-1.5 text-sm text-muted">
            <span className="shrink-0">{formatRu(toKey(new Date(note.updatedAt)))}</span>
            {preview && <span className="truncate">{preview}</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

export function NotesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const rows = useLiveQuery(() => db.notes.toArray(), []);
  const notes = useMemo(() => alive(rows ?? []), [rows]);

  // Индекс поиска считаем один раз на изменение заметок, а не на каждый ввод.
  const index = useMemo(
    () =>
      notes.map((n) => ({
        note: n,
        haystack: `${n.title}\n${htmlToText(n.content)}`.toLowerCase(),
      })),
    [notes],
  );

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      index
        .filter((x) => !q || x.haystack.includes(q))
        .map((x) => x.note)
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
        ),
    [index, q],
  );

  const pinned = filtered.filter((n) => n.pinned);
  const rest = filtered.filter((n) => !n.pinned);

  function del(note: Note) {
    if (window.confirm('Удалить заметку?')) void remove(db.notes, note.id);
  }

  const renderList = (items: Note[]) => (
    <div className="flex flex-col gap-2">
      {items.map((n) => (
        <NoteRow
          key={n.id}
          note={n}
          onOpen={() => navigate(`/notes/${n.id}`)}
          onDelete={() => del(n)}
        />
      ))}
    </div>
  );

  return (
    <Screen title="Заметки">
      <SearchField value={query} onChange={setQuery} className="mb-3" />

      {notes.length === 0 ? (
        <EmptyState icon={NotebookText} title="Пока нет заметок" hint="Нажмите +, чтобы создать первую" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="Ничего не найдено" hint="Попробуйте другой запрос" />
      ) : (
        <>
          {pinned.length > 0 && (
            <div className="mb-4">
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Закреплённые</h2>
              {renderList(pinned)}
            </div>
          )}
          {rest.length > 0 && (
            <div className="mb-4">
              {pinned.length > 0 && (
                <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Заметки</h2>
              )}
              {renderList(rest)}
            </div>
          )}
        </>
      )}

      <Fab onClick={() => navigate('/notes/new')} />
    </Screen>
  );
}
