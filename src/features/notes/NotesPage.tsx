import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLoaded } from '../../hooks/useLoaded';
import { Pin, Search, NotebookText, FolderPlus, ChevronLeft, Check } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchField } from '../../components/ui/Input';
import { db } from '../../db/db';
import { alive, remove, update } from '../../db/repo';
import type { Note, NoteFolder } from '../../db/types';
import { formatRu, toKey } from '../../lib/dates';
import { FolderSheet } from './FolderSheet';
import { plur } from '../../lib/plural';

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
  onMoveToFolder,
}: {
  note: Note;
  onOpen: () => void;
  onDelete: () => void;
  /** Долгое нажатие — перенос в папку. Свайп по строке уже занят удалением, а
   *  перетаскивать строку пальцем через весь список к нужной папке на телефоне
   *  мучительно. */
  onMoveToFolder: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ x: 0, dx: 0, moved: false });

  const text = useMemo(() => htmlToText(note.content), [note.content]);
  const title = note.title || text.split('\n')[0] || 'Без названия';
  const preview = text.split('\n').slice(1).join(' ').trim();

  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heldRef = useRef(false);

  const cancelHold = () => {
    clearTimeout(holdRef.current);
    holdRef.current = undefined;
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, dx, moved: false };
    setDragging(true);
    heldRef.current = false;
    // 500 мс — обычный порог долгого нажатия в iOS. Меньше — срабатывает при
    // обычном тапе, больше — человек успевает решить, что ничего не работает.
    holdRef.current = setTimeout(() => {
      if (drag.current.moved) return; // это свайп, а не удержание
      heldRef.current = true;
      // Отклик обязателен: без него неясно, что удержание засчиталось.
      navigator.vibrate?.(12);
      onMoveToFolder();
    }, 500);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    const d = e.clientX - drag.current.x;
    if (Math.abs(d) > 6) {
      drag.current.moved = true;
      cancelHold(); // палец поехал — это свайп
    }
    setDx(Math.max(-88, Math.min(0, drag.current.dx + d)));
  };
  const onUp = () => {
    cancelHold();
    setDragging(false);
    setDx((cur) => (cur < -44 ? -88 : 0));
  };
  const onClick = () => {
    if (drag.current.moved || heldRef.current) return; // свайп или удержание, не тап
    if (dx !== 0) {
      setDx(0); // открыт — закрываем
      return;
    }
    onOpen();
  };

  return (
    <div className="relative overflow-hidden rounded-2xl shadow-[var(--shadow-card)]">
      {/* Кнопку рендерим ТОЛЬКО при свайпе. В покое (dx=0) её нет в DOM —
          значит ничему просвечивать в скруглённых углах карточки (на iOS
          overflow:hidden не клипает строку с transform, и красный угол торчал
          постоянно). */}
      {dx < 0 && (
        <button
          type="button"
          onClick={onDelete}
          className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center rounded-r-[1.15rem] bg-danger-fill text-sm font-medium text-white"
        >
          Удалить
        </button>
      )}
      <div
        className="card relative flex touch-pan-y items-start gap-2 p-4"
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
  // Открытая папка. null — корень, «Все заметки». Состояние экрана, а не
  // адреса: возврат из заметки не должен выкидывать человека в корень, а
  // отдельный маршрут на папку ради этого — лишняя сущность.
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [folderSheet, setFolderSheet] = useState<NoteFolder | 'new' | null>(null);
  // Режим переноса: выбрана заметка, дальше человек тыкает в папку.
  const [moving, setMoving] = useState<Note | null>(null);

  const rows = useLiveQuery(() => db.notes.toArray(), []);
  const folderRows = useLiveQuery(() => db.noteFolders.toArray(), []);
  const loaded = useLoaded(rows, folderRows);
  const allNotes = useMemo(() => alive(rows ?? []), [rows]);
  const folders = useMemo(
    () => alive(folderRows ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    [folderRows],
  );
  // Что показывать списком: в папке — её заметки, в корне — те, что НЕ
  // разложены. Иначе заметка видна и в папке, и в общем списке, и человек не
  // понимает, перенеслась она или скопировалась.
  const notes = useMemo(
    () =>
      openFolder
        ? allNotes.filter((n) => n.folderId === openFolder)
        : allNotes.filter((n) => !n.folderId),
    [allNotes, openFolder],
  );
  const countIn = (id: string) => allNotes.filter((n) => n.folderId === id).length;
  const current = folders.find((f) => f.id === openFolder) ?? null;

  // Индекс поиска считаем один раз на изменение заметок, а не на каждый ввод.
  // Индекс — по ВСЕМ заметкам, а не по текущему списку: искать надо везде.
  // Результат, молча ограниченный открытой папкой, читается как «заметка
  // пропала», и это худшее, что может сделать раздел заметок.
  const index = useMemo(
    () =>
      allNotes.map((n) => ({
        note: n,
        haystack: `${n.title}\n${htmlToText(n.content)}`.toLowerCase(),
      })),
    [allNotes],
  );

  const q = query.trim().toLowerCase();
  const visibleIds = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const filtered = useMemo(
    () =>
      index
        .filter((x) => (q ? x.haystack.includes(q) : visibleIds.has(x.note.id)))
        .map((x) => x.note)
        .sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
        ),
    [index, q, visibleIds],
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
          onMoveToFolder={() => setMoving(n)}
        />
      ))}
    </div>
  );

  // Перенос заметки. Отдельный режим, а не перетаскивание: тащить строку
  // пальцем через весь список к нужной папке на телефоне мучительно, а свайп
  // по строке уже занят удалением.
  async function moveTo(folderId: string | null) {
    if (!moving) return;
    await update(db.notes, moving.id, { folderId });
    setMoving(null);
  }

  if (moving) {
    return (
      <Screen title="Куда перенести?" backTo="/notes">
        <p className="mb-3 px-1 text-sm leading-snug text-muted">
          Заметка «{moving.title || 'Без названия'}» — выберите папку.
        </p>
        <div className="card divide-y divide-hairline">
          <button
            onClick={() => void moveTo(null)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:opacity-80"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg">
              📄
            </span>
            <span className="min-w-0 flex-1 font-medium">Все заметки</span>
            {!moving.folderId && <Check size={18} className="shrink-0 text-accent" />}
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => void moveTo(f.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:opacity-80"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-lg"
                style={{ background: `${f.color}26` }}
              >
                {f.emoji}
              </span>
              <span className="min-w-0 flex-1 font-medium">{f.name}</span>
              {moving.folderId === f.id && <Check size={18} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
        <button
          onClick={() => setMoving(null)}
          className="mt-4 w-full py-2 text-sm text-muted active:opacity-60"
        >
          Отмена
        </button>
      </Screen>
    );
  }

  return (
    <Screen
      title={current ? `${current.emoji} ${current.name}` : 'Заметки'}
      right={
        current ? (
          <button
            onClick={() => setFolderSheet(current)}
            className="text-sm font-medium text-accent active:opacity-60"
          >
            Изменить
          </button>
        ) : (
          <button
            onClick={() => setFolderSheet('new')}
            aria-label="Новая папка"
            className="p-1 text-accent active:opacity-60"
          >
            <FolderPlus size={20} />
          </button>
        )
      }
    >
      {current && (
        <button
          onClick={() => setOpenFolder(null)}
          className="mb-3 -ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent active:opacity-60"
        >
          <ChevronLeft size={16} /> Все заметки
        </button>
      )}

      <SearchField value={query} onChange={setQuery} className="mb-3" />

      {/* Папки — только в корне и только когда не ищут: во время поиска нужен
          результат по всем заметкам, а не разбивка по хранилищам. */}
      {!current && !q && folders.length > 0 && (
        <div className="card mb-4 divide-y divide-hairline">
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => setOpenFolder(f.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:opacity-80"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-lg"
                style={{ background: `${f.color}26` }}
              >
                {f.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">{countIn(f.id)}</span>
            </button>
          ))}
        </div>
      )}

      {notes.length === 0 ? (
        loaded && (
          <EmptyState
            icon={NotebookText}
            title={current ? 'В папке пусто' : 'Пока нет заметок'}
            hint={
              current
                ? 'Перенесите сюда заметку долгим нажатием на неё в общем списке'
                : 'Нажмите +, чтобы создать первую'
            }
          />
        )
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

      {/* Сводка по корню: сколько заметок вне папок — иначе непонятно, всё ли
          разложено. Показываем, только когда папки есть. */}
      {!current && !q && folders.length > 0 && rest.length > 0 && (
        <p className="mt-1 px-1 text-xs text-muted">
          Вне папок: {plur(allNotes.filter((n) => !n.folderId).length, ['заметка', 'заметки', 'заметок'])}
        </p>
      )}

      <Fab onClick={() => navigate(current ? `/notes/new?folder=${current.id}` : '/notes/new')} />
      <FolderSheet
        key={folderSheet === 'new' ? 'new' : (folderSheet?.id ?? 'closed')}
        open={folderSheet !== null}
        folder={folderSheet === 'new' ? null : folderSheet}
        onClose={() => {
          // Папку могли удалить — тогда возвращаемся в корень, иначе экран
          // остался бы открытым на несуществующей папке.
          if (folderSheet && folderSheet !== 'new') setOpenFolder(null);
          setFolderSheet(null);
        }}
      />
    </Screen>
  );
}
