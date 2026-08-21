import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLoaded } from '../../hooks/useLoaded';
import {
  Pin,
} from 'lucide-react';
import {
  GSearch as Search,
  GChevronLeft as ChevronLeft,
  GCheck as Check,
  GNotes as NotebookText,
  GFolderPlus as FolderPlus,
} from '../../components/ui/glyphs';
import { useNavigate } from 'react-router';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { SearchField } from '../../components/ui/Input';
import { db } from '../../db/db';
import { alive, remove, update } from '../../db/repo';
import type { Note, NoteFolder } from '../../db/types';
import { formatRu, toKey } from '../../lib/dates';
import { t } from '../../lib/i18n';
import { HIT_SLOP_44 } from '../../components/ui/hitSlop';
import { FolderSheet } from './FolderSheet';
import { checklistProgress } from './checklist';
import { countNotesDeep, flattenTree, folderMoveTargets } from './folderTree';
import { ICON } from '../../components/ui/icons';

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
  const title = note.title || text.split('\n')[0] || t('Без названия');
  const progress = useMemo(() => checklistProgress(note.content), [note.content]);
  // Первую строку текста режем, только когда она и есть заголовок (редактор
  // выводит note.title из первой строки — deriveTitle). Если контент
  // начинается с собственного текста, прежняя безусловная обрезка оставляла
  // карточку без превью вовсе.
  const lines = text.split('\n');
  const preview = (lines[0]?.trim() === title.trim() ? lines.slice(1).join(' ') : text).trim();

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
          {t('Удалить')}
        </button>
      )}
      <div
        // Выделение текста здесь запрещено намеренно. Строка списка — кнопка,
        // а не текст для копирования: удержание на ней открывает выбор папки,
        // и по дороге iOS успевала выделить заголовок синим и показать своё
        // меню «Скопировать / Найти». Два действия на один жест, и оба видны
        // одновременно. [-webkit-touch-callout:none] убирает системное меню,
        // select-none — саму подсветку.
        className="card relative flex touch-pan-y items-start gap-2 p-4 select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
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
        {note.pinned && <Pin size={ICON.inline} className="mt-1 shrink-0 text-accent" fill="currentColor" />}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words font-semibold">{title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
            <span className="shrink-0">{formatRu(toKey(new Date(note.updatedAt)))}</span>
            {/* У списка задач важно не начало текста, а сколько осталось —
                ради этого в него и заглядывают из общего списка. */}
            {progress ? (
              <span className="shrink-0 tabular-nums">
                {t('{done} из {total}', { done: progress.done, total: progress.total })}
              </span>
            ) : (
              preview && <span className="truncate">{preview}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// Открытая папка живёт в модуле: маршрут /notes/:id размонтирует экран списка
// целиком, и state внутри компонента терял папку — возврат из заметки всегда
// выкидывал в корень (вопреки прежнему комментарию, который это обещал).
// С вложенными папками терялась бы вся глубина. Отдельный маршрут на папку —
// лишняя сущность: адрес заметки важен (шарится, восстанавливается), адрес
// папки — нет.
let lastOpenFolder: string | null = null;

export function NotesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  // Открытая папка. null — корень, «Все заметки».
  const [openFolder, setOpenFolderState] = useState<string | null>(lastOpenFolder);
  const setOpenFolder = (id: string | null) => {
    lastOpenFolder = id;
    setOpenFolderState(id);
  };
  const [folderSheet, setFolderSheet] = useState<NoteFolder | 'new' | null>(null);
  // Режим переноса: выбрана заметка или папка, дальше человек тыкает в цель.
  // Один экран на обоих — «Куда перенести?» не должен выглядеть по-разному
  // в зависимости от того, что именно несут.
  const [moving, setMoving] = useState<
    { kind: 'note'; note: Note } | { kind: 'folder'; folder: NoteFolder } | null
  >(null);

  const rows = useLiveQuery(() => db.notes.toArray(), []);
  const folderRows = useLiveQuery(() => db.noteFolders.toArray(), []);
  const loaded = useLoaded(rows, folderRows);
  const allNotes = useMemo(() => alive(rows ?? []), [rows]);
  const folders = useMemo(
    () => alive(folderRows ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    [folderRows],
  );
  const current = folders.find((f) => f.id === openFolder) ?? null;
  // Запомненная папка могла исчезнуть (удалена с другого устройства, пока мы
  // были в редакторе) — тогда работаем от корня, а не от призрака: иначе
  // экран показывал бы вечное «пусто» без кнопки назад.
  const level = current ? openFolder : null;
  // Что показывать списком: в папке — её заметки, в корне — те, что НЕ
  // разложены. Иначе заметка видна и в папке, и в общем списке, и человек не
  // понимает, перенеслась она или скопировалась.
  const notes = useMemo(
    () =>
      level ? allNotes.filter((n) => n.folderId === level) : allNotes.filter((n) => !n.folderId),
    [allNotes, level],
  );
  const countIn = (id: string) => countNotesDeep(allNotes, folders, id);
  // Папки ТЕКУЩЕГО уровня: подпапки открытой папки, в корне — корневые.
  // Вложенность как в Apple Notes: каждый экран показывает один уровень.
  const levelFolders = useMemo(
    () => folders.filter((f) => (f.parentId ?? null) === level),
    [folders, level],
  );
  const parent = current ? (folders.find((f) => f.id === current.parentId) ?? null) : null;

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
    if (window.confirm(t('Удалить заметку?'))) void remove(db.notes, note.id);
  }

  const renderList = (items: Note[]) => (
    <div className="flex flex-col gap-2">
      {items.map((n) => (
        <NoteRow
          key={n.id}
          note={n}
          onOpen={() => navigate(`/notes/${n.id}`)}
          onDelete={() => del(n)}
          onMoveToFolder={() => setMoving({ kind: 'note', note: n })}
        />
      ))}
    </div>
  );

  /** Список заметок: сначала закреплённые, потом остальные.
   *
   *  Заголовок «Вне папок» появляется только в корне и только когда папки
   *  вообще есть, — иначе он объясняет разделение, которого человек не видит.
   *  При поиске заголовков нет вовсе: найденное лежит где угодно, и делить
   *  результат на «вне папок» и остальное значило бы врать о том, где оно. */
  const renderFound = () => (
    <>
      {pinned.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">{t('Закреплённые')}</h2>
          {renderList(pinned)}
        </div>
      )}
      {rest.length > 0 && (
        <div className="mb-4">
          {!q && (pinned.length > 0 || levelFolders.length > 0) && (
            <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">
              {!current && levelFolders.length > 0 ? t('Вне папок') : t('Заметки')}
            </h2>
          )}
          {renderList(rest)}
        </div>
      )}
    </>
  );

  // Перенос заметки или папки. Отдельный режим, а не перетаскивание: тащить
  // строку пальцем через весь список к нужной папке на телефоне мучительно,
  // а свайп по строке уже занят удалением.
  async function moveTo(folderId: string | null) {
    if (!moving) return;
    if (moving.kind === 'note') await update(db.notes, moving.note.id, { folderId });
    else await update(db.noteFolders, moving.folder.id, { parentId: folderId });
    setMoving(null);
  }

  if (moving) {
    // Куда сейчас положено то, что несут, — у этой цели рисуем галочку.
    const movingParent =
      moving.kind === 'note' ? moving.note.folderId : (moving.folder.parentId ?? null);
    // Папку нельзя положить в себя или своего потомка — таких целей в списке
    // просто нет; для заметки годится любая папка.
    const targets =
      moving.kind === 'note' ? flattenTree(folders) : folderMoveTargets(folders, moving.folder.id);
    return (
      <Screen title={t('Куда перенести?')} onBack={() => setMoving(null)}>
        <p className="mb-3 px-1 text-sm leading-snug text-muted">
          {moving.kind === 'note'
            ? t('Заметка «{title}» — выберите папку.', {
                title: moving.note.title || t('Без названия'),
              })
            : t('Папка «{name}» — выберите, куда её вложить.', { name: moving.folder.name })}
        </p>
        <div className="card divide-y divide-hairline">
          <button
            onClick={() => void moveTo(null)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:opacity-80"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-lg">
              📄
            </span>
            <span className="min-w-0 flex-1 font-medium">{t('Все заметки')}</span>
            {movingParent === null && <Check size={ICON.base} className="shrink-0 text-accent" />}
          </button>
          {/* Всё дерево одним списком: вложенность показана отступом, как в
              «Куда перенести?» Apple Notes, — переносить можно на любой
              уровень, не проваливаясь по папкам. */}
          {targets.map(({ folder: f, depth }) => (
            <button
              key={f.id}
              onClick={() => void moveTo(f.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:opacity-80"
              style={depth > 0 ? { paddingLeft: `${16 + depth * 24}px` } : undefined}
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl text-lg"
                style={{ background: `${f.color}26` }}
              >
                {f.emoji}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
              {movingParent === f.id && <Check size={ICON.base} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
        <button
          onClick={() => setMoving(null)}
          className="mt-4 w-full py-2 text-sm text-muted active:opacity-60"
        >
          {t('Отмена')}
        </button>
      </Screen>
    );
  }

  return (
    <Screen
      title={current ? `${current.emoji} ${current.name}` : t('Заметки')}
      right={
        <div className="flex items-center gap-1">
          {/* Новая папка создаётся на ТЕКУЩЕМ уровне: в корне — корневая,
              внутри папки — вложенная, как в Apple Notes. */}
          <button
            onClick={() => setFolderSheet('new')}
            aria-label={current ? t('Новая вложенная папка') : t('Новая папка')}
            className={`p-1 text-accent active:opacity-60 ${HIT_SLOP_44}`}
          >
            <FolderPlus size={ICON.header} />
          </button>
          {current && (
            <button
              onClick={() => setFolderSheet(current)}
              className="pl-1 text-sm font-medium text-accent active:opacity-60"
            >
              {t('Изменить')}
            </button>
          )}
        </div>
      }
    >
      {current && (
        <button
          onClick={() => setOpenFolder(current.parentId ?? null)}
          className="mb-3 -ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent active:opacity-60"
        >
          {/* Назад — на уровень выше, а не всегда в корень: внутри вложенной
              папки «Все заметки» перепрыгивал бы родителя. */}
          <ChevronLeft size={ICON.action} /> {parent ? `${parent.emoji} ${parent.name}` : t('Все заметки')}
        </button>
      )}

      <SearchField value={query} onChange={setQuery} className="mb-3" />

      {/* Папки текущего уровня — и только когда не ищут: во время поиска нужен
          результат по всем заметкам, а не разбивка по хранилищам. */}
      {!q && levelFolders.length > 0 && (
        <div className="card mb-4 divide-y divide-hairline">
          {levelFolders.map((f) => (
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

      {/* Поиск проверяется ПЕРВЫМ, и это не вкусовщина.
          Раньше первой стояла ветка «notes.length === 0», а notes — срез только
          текущего уровня: в корне это заметки БЕЗ папки. Стоило разложить всё
          по папкам, и корневой срез становился пуст — поиск по любому слову
          рисовал «Пока нет заметок», хотя найденное лежало в filtered (он
          считается по ВСЕМ заметкам). То же внутри пустой папки: «В папке
          пусто» вместо результата. Ровно то поведение, которое комментарий у
          индекса объявляет худшим, что может сделать раздел заметок. */}
      {q ? (
        filtered.length === 0 ? (
          <EmptyState icon={Search} title={t('Ничего не найдено')} hint={t('Попробуйте другой запрос')} />
        ) : (
          renderFound()
        )
      ) : notes.length === 0 ? (
        // Пустой уровень — это когда нет НИ заметок, НИ подпапок: экран с
        // одними папками не «пуст», и говорить так — врать о содержимом.
        loaded &&
        levelFolders.length === 0 && (
          <EmptyState
            icon={NotebookText}
            title={current ? t('В папке пусто') : t('Пока нет заметок')}
            hint={
              current
                ? t('Перенесите сюда заметку долгим нажатием на неё в общем списке')
                : t('Нажмите +, чтобы создать первую')
            }
          />
        )
      ) : (
        renderFound()
      )}

      <Fab onClick={() => navigate(current ? `/notes/new?folder=${current.id}` : '/notes/new')} />
      <FolderSheet
        key={folderSheet === 'new' ? 'new' : (folderSheet?.id ?? 'closed')}
        open={folderSheet !== null}
        folder={folderSheet === 'new' ? null : folderSheet}
        parentId={level}
        onClose={() => setFolderSheet(null)}
        onDeleted={() => {
          // С удалённой папки уходим к её родителю — там теперь лежит её
          // содержимое. Обычное закрытие шита (правка имени) не дёргает
          // навигацию вовсе: раньше любой выход из «Изменить» выкидывал в
          // корень.
          setOpenFolder(current?.parentId ?? null);
        }}
        onMove={(f) => {
          setFolderSheet(null);
          setMoving({ kind: 'folder', folder: f });
        }}
      />
    </Screen>
  );
}
