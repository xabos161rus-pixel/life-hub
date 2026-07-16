import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, ChevronRight, Folder, FolderPlus, ListChecks, Pencil, Plus, Repeat, Snowflake, Sun } from 'lucide-react';
import { db } from '../../db/db';
import { alive, update } from '../../db/repo';
import type { Project, Task } from '../../db/types';
import { Screen } from '../../components/layout/Screen';
import { Fab } from '../../components/layout/Fab';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/EmptyState';
import { Hint } from '../../components/ui/Hint';
import { useToast } from '../../components/ui/Toast';
import { formatDueDate } from '../../lib/dates';
import { describeRecurrence } from '../../lib/recurrence';
import { ProjectEditSheet } from './ProjectEditSheet';
import { QuickAddBar } from './QuickAddBar';
import { TaskEditSheet } from './TaskEditSheet';
import { TaskItem } from './TaskItem';
import { FreezeSheet } from './FreezeSheet';
import { unfreezeAll, unfreezeTask } from './taskActions';

const NONE = '__none__';
const FROZEN = '__frozen__'; // ключ свёрнутости секции «Заморожено»

// Авто-скролл во время drag: зона у краёв скролл-контейнера и шаг за кадр.
const SCROLL_EDGE = 72; // px от верх/низ края, где включается авто-скролл
const SCROLL_STEP = 11; // px за кадр

// Переупорядочивание проектов: удержание заголовка → drag.
const LONG_PRESS_MS = 400; // удержание без движения → старт drag
const DRAG_CANCEL_MOVE = 8; // сдвиг до старта = скролл, а не drag — отменяем

/** Ближайший прокручиваемый предок (overflow-y auto/scroll с переполнением). */
function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

/** Иконка папки проекта: стандартная 📁 заменяется папкой в цвете проекта —
 *  выбранный при создании цвет виден прямо в списке. Своё эмодзи — как есть. */
function ProjectFolderIcon({ project }: { project: Project }) {
  const emoji = project.emoji?.trim();
  if (emoji && emoji !== '📁') return <span className="text-[17px] leading-none">{emoji}</span>;
  return (
    <Folder
      size={18}
      aria-hidden
      style={{ color: project.color, fill: project.color, strokeWidth: 1.5 }}
    />
  );
}

/** Сворачиваемая секция с заголовком, счётчиком и (опц.) карандашом.
 *  dropRef/dropKey/highlight — для drag-and-drop: вся секция служит drop-зоной,
 *  ключ цели читается из data-drop-key узла. */
function Section({
  title,
  icon,
  count,
  collapsed,
  onToggle,
  onEdit,
  dropRef,
  dropKey,
  highlight = false,
  onReorderStart,
  isReorderSource = false,
  children,
}: {
  title: string;
  /** Иконка перед заголовком (цветная папка проекта / эмодзи). */
  icon?: ReactNode;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  dropRef?: (el: HTMLElement | null) => void;
  dropKey?: string;
  highlight?: boolean;
  /** Передаётся только реальным проектам — включает long-press переупорядочивания. */
  onReorderStart?: (at: { x: number; y: number }) => void;
  /** Этот проект сейчас перетаскивают — приглушаем. */
  isReorderSource?: boolean;
  children: ReactNode;
}) {
  const reorderable = Boolean(onReorderStart);
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const startPt = useRef({ x: 0, y: 0 });
  const headerRef = useRef<HTMLButtonElement>(null);
  const pointerIdRef = useRef(0);

  const cancelPress = () => {
    if (pressTimer.current != null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  const endHeaderDrag = () => {
    const el = headerRef.current;
    if (!el) return;
    el.style.touchAction = '';
    try {
      el.releasePointerCapture(pointerIdRef.current);
    } catch {
      /* указатель уже отпущен */
    }
  };
  const headerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!reorderable) return;
    longFired.current = false;
    startPt.current = { x: e.clientX, y: e.clientY };
    pointerIdRef.current = e.pointerId;
    cancelPress();
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      longFired.current = true;
      // Палец неподвижен — блокируем нативный скролл для этого касания и
      // держим события на заголовке (иначе вертикальный перенос iOS заберёт).
      const el = headerRef.current;
      if (el) {
        el.style.touchAction = 'none';
        try {
          el.setPointerCapture(pointerIdRef.current);
        } catch {
          /* указатель уже неактивен */
        }
      }
      onReorderStart?.(startPt.current);
    }, LONG_PRESS_MS);
  };
  const headerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (pressTimer.current == null) return;
    if (
      Math.abs(e.clientX - startPt.current.x) > DRAG_CANCEL_MOVE ||
      Math.abs(e.clientY - startPt.current.y) > DRAG_CANCEL_MOVE
    ) {
      cancelPress(); // палец поехал — это скролл, а не удержание
    }
  };
  const onHeaderUp = () => {
    cancelPress();
    endHeaderDrag();
  };
  const headerClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (longFired.current) {
      e.preventDefault(); // был long-press — не сворачиваем секцию
      longFired.current = false;
      return;
    }
    onToggle();
  };

  return (
    <section
      ref={dropRef}
      data-drop-key={dropKey}
      className={`mb-12 rounded-2xl transition-[background-color,opacity] ${
        highlight ? 'bg-accent/10 ring-2 ring-accent' : ''
      } ${isReorderSource ? 'opacity-40' : ''}`}
    >
      <div className="mb-2 flex items-center gap-1 px-1">
        <button
          ref={headerRef}
          onClick={headerClick}
          onPointerDown={headerDown}
          onPointerMove={headerMove}
          onPointerUp={onHeaderUp}
          onPointerCancel={onHeaderUp}
          className={`flex flex-1 items-center gap-1.5 text-left ${
            reorderable ? 'select-none [-webkit-touch-callout:none] [-webkit-user-select:none]' : ''
          }`}
        >
          <ChevronDown
            size={18}
            className={`shrink-0 text-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          {icon && <span className="flex shrink-0 items-center">{icon}</span>}
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <span className="text-sm text-muted">{count}</span>
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            aria-label="Редактировать проект"
            className="p-1.5 text-muted active:opacity-60"
          >
            <Pencil size={14} />
          </button>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

/** Тонкая линия-индикатор вставки задачи между строками. */
function TaskDropLine() {
  return (
    <div className="my-1.5 h-1 rounded-full bg-accent shadow-[0_0_10px_2px_var(--app-accent)]" aria-hidden />
  );
}

function TaskCard({
  tasks,
  projectById,
  onEdit,
  muted,
  onDragStart,
  draggingId,
  dropIndex,
}: {
  tasks: Task[];
  projectById: Map<string, Project>;
  onEdit: (t: Task) => void;
  muted?: boolean;
  /** Передаётся только в активных секциях — включает drag переноса. */
  onDragStart?: (t: Task, at: { x: number; y: number }) => void;
  /** id перетаскиваемой задачи для визуального сигнала источника. */
  draggingId?: string | null;
  /** Зазор вставки перетаскиваемой задачи (0..N) — рисуем линию. null — нет. */
  dropIndex?: number | null;
}) {
  return (
    <div
      className={`card divide-y divide-hairline px-4 ${muted ? 'opacity-60' : ''}`}
    >
      {tasks.map((t, i) => (
        <Fragment key={t.id}>
          {dropIndex === i && <TaskDropLine />}
          <TaskItem
            task={t}
            project={t.projectId ? (projectById.get(t.projectId) ?? null) : null}
            onEdit={onEdit}
            onDragStart={onDragStart}
            isDragSource={draggingId === t.id}
            hideProject
          />
        </Fragment>
      ))}
      {dropIndex === tasks.length && <TaskDropLine />}
    </div>
  );
}

/** Свёрнутая по умолчанию под-секция выполненных задач внутри группы (#13). */
function CompletedSubsection({
  tasks,
  projectById,
  onEdit,
  expanded,
  onToggle,
}: {
  tasks: Task[];
  projectById: Map<string, Project>;
  onEdit: (t: Task) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-2">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-1 py-1 text-left text-sm text-muted active:opacity-60"
      >
        <ChevronRight
          size={14}
          className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span>Выполненные</span>
        <span className="text-xs">{tasks.length}</span>
      </button>
      {expanded && (
        <div className="mt-1 max-h-72 overflow-y-auto">
          <TaskCard tasks={tasks} projectById={projectById} onEdit={onEdit} muted />
        </div>
      )}
    </div>
  );
}

/** Секция «Заморожено» — задачи на паузе. Каждую можно разморозить, либо все разом. */
function FrozenSection({
  tasks,
  projectById,
  collapsed,
  onToggle,
  onEdit,
}: {
  tasks: Task[];
  projectById: Map<string, Project>;
  collapsed: boolean;
  onToggle: () => void;
  onEdit: (t: Task) => void;
}) {
  const toast = useToast();
  return (
    <section className="mb-12">
      <div className="mb-2 flex items-center gap-1 px-1">
        <button onClick={onToggle} className="flex flex-1 items-center gap-1.5 text-left">
          <ChevronDown
            size={18}
            className={`shrink-0 text-muted transition-transform ${collapsed ? '-rotate-90' : ''}`}
          />
          <Snowflake size={16} className="shrink-0 text-accent" />
          <h2 className="text-lg font-bold tracking-tight">Заморожено</h2>
          <span className="text-sm text-muted">{tasks.length}</span>
        </button>
        <button
          onClick={() => void unfreezeAll().then(() => toast('Все задачи разморожены'))}
          className="shrink-0 px-2 py-1 text-sm font-medium text-accent active:opacity-60"
        >
          Разморозить всё
        </button>
      </div>
      {!collapsed && (
        <div className="card divide-y divide-hairline px-4">
          {tasks.map((t) => {
            const project = t.projectId ? projectById.get(t.projectId) : null;
            return (
              <div key={t.id} className="flex items-center gap-3 py-3">
                <button onClick={() => onEdit(t)} className="min-w-0 flex-1 text-left active:opacity-70">
                  <p className="truncate font-medium">{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    {t.dueDate && (
                      <span>
                        {formatDueDate(t.dueDate)}
                        {t.dueTime ? `, ${t.dueTime}` : ''}
                      </span>
                    )}
                    {t.recurrence && (
                      <span className="flex items-center gap-0.5">
                        <Repeat size={11} />
                        {describeRecurrence(t.recurrence)}
                      </span>
                    )}
                    {project && (
                      <span className="truncate">
                        {project.emoji} {project.name}
                      </span>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => void unfreezeTask(t).then(() => toast('Разморожено'))}
                  aria-label="Разморозить задачу"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent active:opacity-70"
                >
                  <Sun size={17} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Линия-индикатор вставки при перетаскивании проекта — показывает, куда он встанет. */
function DropLine() {
  return (
    <div className="mx-1 mb-4 flex items-center gap-2" aria-hidden>
      <span className="size-3 shrink-0 rounded-full bg-accent shadow-[0_0_10px_2px_var(--app-accent)]" />
      <span className="h-1.5 flex-1 rounded-full bg-accent shadow-[0_0_12px_2px_var(--app-accent)]" />
    </div>
  );
}

function AddTaskRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Добавить задачу"
      className="mt-1.5 flex items-center gap-1.5 px-1 py-1.5 text-sm font-medium text-accent active:opacity-60"
    >
      <Plus size={15} /> Задача
    </button>
  );
}

export function TasksPage() {
  const toast = useToast();
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskDefaultProject, setTaskDefaultProject] = useState<string | null>(null);
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [freezeSheetOpen, setFreezeSheetOpen] = useState(false);

  // --- Drag-and-drop переноса задачи между секциями-проектами ---
  // Задача, которую сейчас тащим (захвачена long-press внутри TaskItem).
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  // Координаты пальца для «призрака» у курсора.
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // То же в ref — читается в RAF-цикле авто-скролла без устаревшего замыкания.
  const pointerRef = useRef({ x: 0, y: 0 });
  // Ключ секции под пальцем (projectId | NONE) — для подсветки drop-зоны.
  const [dropKey, setDropKey] = useState<string | null>(null);
  // Индекс вставки задачи внутри проекта-цели (зазор) — для линии и точного дропа.
  const [taskDropIndex, setTaskDropIndex] = useState<number | null>(null);
  const taskDropIndexRef = useRef<number | null>(null);
  // Реестр DOM-узлов секций для hit-теста по Y пальца (ключ = data-drop-key).
  const sectionNodes = useRef<Map<string, HTMLElement>>(new Map());
  // Актуальный dropKey для window-обработчика pointerup (обновляется в move).
  const dropKeyRef = useRef<string | null>(null);
  // Имена проектов по id — для тоста переноса. Синкается из projects в effect.
  const projectNamesRef = useRef<Map<string, string>>(new Map());
  // Актуальные активные задачи по проектам — для finish-обработчика drag.
  const activeByProjectRef = useRef<Map<string, Task[]>>(new Map());

  // --- Переупорядочивание проектов (long-press заголовка) ---
  // projInsertIndex — «зазор» (0..N), куда встанет проект; рисуем там линию.
  const [draggingProject, setDraggingProject] = useState<Project | null>(null);
  const [projInsertIndex, setProjInsertIndex] = useState<number | null>(null);
  const projInsertRef = useRef<number | null>(null);
  const projectsRef = useRef<Project[]>([]);

  const onProjectReorderStart = useCallback((p: Project, at: { x: number; y: number }) => {
    pointerRef.current = at; // стартовая позиция пальца — «призрак» из неё, не из угла
    setPointer(at);
    const idx = projectsRef.current.findIndex((x) => x.id === p.id);
    projInsertRef.current = idx;
    setProjInsertIndex(idx);
    setDraggingProject(p);
  }, []);

  // Единственный стабильный ref-колбэк: ключ берётся из data-drop-key самого
  // узла, поэтому идентичность колбэка постоянна и React не дёргает его лишний раз.
  const registerSection = useCallback((el: HTMLElement | null) => {
    if (!el) return; // detach: чистим по значению ниже (узлы с тем же ключом перезапишутся)
    const key = el.dataset.dropKey;
    if (key) sectionNodes.current.set(key, el);
  }, []);

  // Какая секция под точкой Y. Узлы, выпавшие из DOM, отсеиваются по rect=0.
  const hitTest = useCallback((y: number): string | null => {
    for (const [key, el] of sectionNodes.current) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return key;
    }
    return null;
  }, []);

  const onDragStart = useCallback((t: Task, at: { x: number; y: number }) => {
    const key = t.projectId ?? NONE;
    dropKeyRef.current = key;
    pointerRef.current = at; // стартовая позиция пальца — иначе «призрак» из угла
    setPointer(at);
    setDraggingTask(t);
    setDropKey(key);
  }, []);

  // Window-слушатели активны только во время drag. Перенос/тосты/авто-скролл — здесь.
  useEffect(() => {
    if (!draggingTask) return;
    const task = draggingTask; // фикс ссылки для замыкания finish

    // Прокручиваемый контейнер берём от любой секции (все внутри одного скролла).
    const anySection = sectionNodes.current.values().next().value ?? null;
    const scroller = getScrollParent(anySection);

    // Подсветка drop-зоны по Y пальца, без лишних setState на каждый кадр.
    const refreshDrop = (y: number) => {
      const key = hitTest(y);
      if (key !== dropKeyRef.current) {
        dropKeyRef.current = key;
        setDropKey(key);
      }
      // Зазор вставки среди отображаемых активных задач проекта-цели.
      let idx = 0;
      if (key) {
        const sec = sectionNodes.current.get(key);
        const list = activeByProjectRef.current.get(key) ?? [];
        if (sec) {
          for (const at of list) {
            const el = sec.querySelector(`[data-task-id="${at.id}"]`);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (y > r.top + r.height / 2) idx++;
          }
        }
      }
      if (idx !== taskDropIndexRef.current) {
        taskDropIndexRef.current = idx;
        setTaskDropIndex(idx);
      }
    };

    const move = (e: PointerEvent) => {
      e.preventDefault(); // блокируем скролл, пока тащим
      pointerRef.current = { x: e.clientX, y: e.clientY };
      setPointer({ x: e.clientX, y: e.clientY });
      refreshDrop(e.clientY);
    };

    // Авто-скролл, пока палец у края: крутим контейнер и переоцениваем drop-зону
    // даже когда палец стоит на месте (move-события при этом не приходят).
    let raf = 0;
    const tick = () => {
      const y = pointerRef.current.y;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (y < r.top + SCROLL_EDGE && scroller.scrollTop > 0) {
          scroller.scrollTop -= SCROLL_STEP;
        } else if (y > r.bottom - SCROLL_EDGE && scroller.scrollTop < max) {
          scroller.scrollTop += SCROLL_STEP;
        }
      }
      refreshDrop(y);
      raf = requestAnimationFrame(tick);
    };

    const finish = () => {
      const target = dropKeyRef.current;
      const idx = taskDropIndexRef.current ?? 0;
      if (target) {
        const nextProjectId = target === NONE ? null : target;
        // Новый порядок активных задач проекта-цели с задачей на позиции idx.
        const current = (activeByProjectRef.current.get(target) ?? []).map((t) => t.id);
        const from = current.indexOf(task.id);
        let order: string[];
        if (from === -1) {
          order = [...current];
          order.splice(idx, 0, task.id); // из другого проекта — без сдвига
        } else {
          order = current.filter((id) => id !== task.id);
          order.splice(idx > from ? idx - 1 : idx, 0, task.id);
        }
        order.forEach((id, i) => {
          const sortOrder = (i + 1) * 1000;
          if (id === task.id) void update(db.tasks, id, { projectId: nextProjectId, sortOrder });
          else void update(db.tasks, id, { sortOrder });
        });
        if (nextProjectId !== task.projectId) {
          const name =
            nextProjectId === null ? 'Без проекта' : (projectNamesRef.current.get(target) ?? 'проект');
          toast(`Перенесено в ${name}`);
        }
      }
      dropKeyRef.current = null;
      taskDropIndexRef.current = null;
      setDraggingTask(null);
      setDropKey(null);
      setTaskDropIndex(null);
    };

    // passive:false — иначе preventDefault на touch не сработает.
    const preventScroll = (ev: TouchEvent) => ev.preventDefault();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('touchmove', preventScroll, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    // На время drag глушим скролл страницы (свой авто-скролл — программный).
    const prevTouch = document.body.style.touchAction;
    document.body.style.touchAction = 'none';
    if (scroller) raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('touchmove', preventScroll);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.touchAction = prevTouch;
      cancelAnimationFrame(raf);
    };
  }, [draggingTask, hitTest, toast]);

  // Window-слушатели переупорядочивания проектов — активны только во время drag.
  useEffect(() => {
    if (!draggingProject) return;
    const dp = draggingProject;
    const anySection = sectionNodes.current.values().next().value ?? null;
    const scroller = getScrollParent(anySection);

    const refreshDrop = (y: number) => {
      // Зазор вставки = сколько проектов своей серединой выше пальца.
      let idx = 0;
      for (const proj of projectsRef.current) {
        const el = sectionNodes.current.get(proj.id);
        if (!el || !el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (y > r.top + r.height / 2) idx++;
      }
      if (idx !== projInsertRef.current) {
        projInsertRef.current = idx;
        setProjInsertIndex(idx);
      }
    };
    const move = (e: PointerEvent) => {
      e.preventDefault();
      pointerRef.current = { x: e.clientX, y: e.clientY };
      setPointer({ x: e.clientX, y: e.clientY });
      refreshDrop(e.clientY);
    };
    let raf = 0;
    const tick = () => {
      const y = pointerRef.current.y;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (y < r.top + SCROLL_EDGE && scroller.scrollTop > 0) scroller.scrollTop -= SCROLL_STEP;
        else if (y > r.bottom - SCROLL_EDGE && scroller.scrollTop < max) scroller.scrollTop += SCROLL_STEP;
      }
      refreshDrop(y);
      raf = requestAnimationFrame(tick);
    };
    const finish = () => {
      const insertIndex = projInsertRef.current;
      const ids = projectsRef.current.map((p) => p.id);
      const from = ids.indexOf(dp.id);
      if (from !== -1 && insertIndex != null) {
        const next = ids.filter((id) => id !== dp.id);
        const insertAt = insertIndex > from ? insertIndex - 1 : insertIndex;
        next.splice(insertAt, 0, dp.id);
        const changed = next.some((id, i) => ids[i] !== id);
        if (changed) {
          next.forEach((id, i) => {
            const cur = projectsRef.current.find((p) => p.id === id);
            const order = (i + 1) * 1000;
            if (cur && cur.sortOrder !== order) void update(db.projects, id, { sortOrder: order });
          });
          toast('Порядок проектов обновлён');
        }
      }
      projInsertRef.current = null;
      setDraggingProject(null);
      setProjInsertIndex(null);
    };
    const preventScroll = (ev: TouchEvent) => ev.preventDefault();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('touchmove', preventScroll, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    const prevTouch = document.body.style.touchAction;
    document.body.style.touchAction = 'none';
    if (scroller) raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('touchmove', preventScroll);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.touchAction = prevTouch;
      cancelAnimationFrame(raf);
    };
  }, [draggingProject, hitTest, toast]);

  // Свёрнутые группы (проекты/«Без проекта»). По умолчанию все развёрнуты.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Развёрнутые под-секции выполненных по ключу группы. По умолчанию — свёрнуты.
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(() => new Set());

  const tasksRaw = useLiveQuery(() => db.tasks.toArray(), []);
  const projectsRaw = useLiveQuery(() => db.projects.toArray(), []);

  const allTasks = alive(tasksRaw ?? []);
  // Уникальные теги из живых задач для фильтра.
  const tagOptions = useMemo(
    () => [...new Set(allTasks.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b)),
    [allTasks],
  );
  const tasks = activeTag ? allTasks.filter((t) => t.tags.includes(activeTag)) : allTasks;
  // Проекты сверху вниз в порядке создания (sortOrder растёт → новые ниже).
  const projects = alive(projectsRaw ?? [])
    .filter((p) => !p.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  // Синк имён проектов в ref для тоста переноса (читается в pointerup-обработчике).
  useEffect(() => {
    projectNamesRef.current = new Map(projects.map((p) => [p.id, p.name]));
    projectsRef.current = projects; // для finish-обработчика drag без устаревания
  }, [projects]);
  const loaded = tasksRaw !== undefined;

  const activeByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.completedAt || t.frozenAt) continue; // замороженные — в отдельной секции
      const key = t.projectId ?? NONE;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    // Ручной порядок: по sortOrder (перетаскивание задаёт позицию).
    for (const arr of map.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [tasks]);
  // Актуальные активные задачи по проектам — для finish-обработчика drag.
  useEffect(() => {
    activeByProjectRef.current = activeByProject;
  }, [activeByProject]);

  // Выполненные сгруппированы по проекту (key = projectId | NONE),
  // внутри группы — по completedAt убыв.
  const completedByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.completedAt) continue;
      const key = t.projectId ?? NONE;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    }
    return map;
  }, [tasks]);

  const noProjectTasks = activeByProject.get(NONE) ?? [];
  const noProjectCompleted = completedByProject.get(NONE) ?? [];

  // Замороженные задачи — отдельной секцией внизу (вне активного списка и статистики).
  const frozenTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.frozenAt && !t.completedAt)
        .sort((a, b) => (b.frozenAt ?? '').localeCompare(a.frozenAt ?? '')),
    [tasks],
  );

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCompleted(key: string) {
    setExpandedCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openTask(task: Task | null, projectId: string | null) {
    setEditingTask(task);
    setTaskDefaultProject(projectId);
    setTaskSheetOpen(true);
  }

  function openProject(project: Project | null) {
    setEditingProject(project);
    setProjectSheetOpen(true);
  }

  const empty = loaded && allTasks.length === 0 && projects.length === 0;

  return (
    <Screen
      title="Задачи"
      right={
        <button
          onClick={() => setFreezeSheetOpen(true)}
          aria-label="Заморозить задачи"
          className="p-1 text-accent active:opacity-60"
        >
          <Snowflake size={22} />
        </button>
      }
    >
      <QuickAddBar />

      {tagOptions.length > 0 && (
        <div className="mb-4">
          <ChipRow>
            <Chip active={activeTag === null} onClick={() => setActiveTag(null)}>
              Все теги
            </Chip>
            {tagOptions.map((tag) => (
              <Chip
                key={tag}
                active={activeTag === tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              >
                #{tag}
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}

      {empty ? (
        <EmptyState
          icon={ListChecks}
          title="Пока нет задач"
          hint="Нажмите «+», чтобы добавить первую задачу"
        />
      ) : (
        <>
          {allTasks.length > 0 && (
            <Hint id="tasks-gestures" className="mb-4">
              Свайп по задаче вправо — выполнить, влево — «Завтра» или «Удалить».
              Удержание задачи — перенести в другой проект, удержание заголовка
              проекта — изменить порядок папок.
            </Hint>
          )}
          {projects.map((p, i) => {
            const list = activeByProject.get(p.id) ?? [];
            const doneList = completedByProject.get(p.id) ?? [];
            return (
              <Fragment key={p.id}>
                {draggingProject && projInsertIndex === i && <DropLine />}
                <Section
                  title={p.name}
                  icon={<ProjectFolderIcon project={p} />}
                  count={list.length}
                  collapsed={collapsed.has(p.id)}
                  onToggle={() => toggle(p.id)}
                  onEdit={() => openProject(p)}
                  dropRef={registerSection}
                  dropKey={p.id}
                  highlight={Boolean(draggingTask) && dropKey === p.id}
                  onReorderStart={(at) => onProjectReorderStart(p, at)}
                  isReorderSource={draggingProject?.id === p.id}
                >
                  {doneList.length > 0 && (
                    <CompletedSubsection
                      tasks={doneList}
                      projectById={projectById}
                      onEdit={(t) => openTask(t, t.projectId)}
                      expanded={expandedCompleted.has(p.id)}
                      onToggle={() => toggleCompleted(p.id)}
                    />
                  )}
                  {list.length > 0 && (
                    <TaskCard
                      tasks={list}
                      projectById={projectById}
                      onEdit={(t) => openTask(t, t.projectId)}
                      onDragStart={onDragStart}
                      draggingId={draggingTask?.id ?? null}
                      dropIndex={draggingTask && dropKey === p.id ? taskDropIndex : null}
                    />
                  )}
                  <AddTaskRow onClick={() => openTask(null, p.id)} />
                </Section>
              </Fragment>
            );
          })}
          {draggingProject && projInsertIndex === projects.length && <DropLine />}

          {(noProjectTasks.length > 0 || noProjectCompleted.length > 0) && (
            <Section
              title="Без проекта"
              count={noProjectTasks.length}
              collapsed={collapsed.has(NONE)}
              onToggle={() => toggle(NONE)}
              dropRef={registerSection}
              dropKey={NONE}
              highlight={Boolean(draggingTask) && dropKey === NONE}
            >
              {noProjectCompleted.length > 0 && (
                <CompletedSubsection
                  tasks={noProjectCompleted}
                  projectById={projectById}
                  onEdit={(t) => openTask(t, null)}
                  expanded={expandedCompleted.has(NONE)}
                  onToggle={() => toggleCompleted(NONE)}
                />
              )}
              {noProjectTasks.length > 0 && (
                <TaskCard
                  tasks={noProjectTasks}
                  projectById={projectById}
                  onEdit={(t) => openTask(t, null)}
                  onDragStart={onDragStart}
                  draggingId={draggingTask?.id ?? null}
                  dropIndex={draggingTask && dropKey === NONE ? taskDropIndex : null}
                />
              )}
              <AddTaskRow onClick={() => openTask(null, null)} />
            </Section>
          )}

          <button
            onClick={() => openProject(null)}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border py-3 text-sm font-medium text-muted active:opacity-70"
          >
            <FolderPlus size={16} /> Новый проект
          </button>

          {frozenTasks.length > 0 && (
            <div className="mt-12">
              <FrozenSection
                tasks={frozenTasks}
                projectById={projectById}
                collapsed={collapsed.has(FROZEN)}
                onToggle={() => toggle(FROZEN)}
                onEdit={(t) => openTask(t, t.projectId)}
              />
            </div>
          )}
        </>
      )}

      <Fab onClick={() => openTask(null, null)} />

      <TaskEditSheet
        open={taskSheetOpen}
        onClose={() => setTaskSheetOpen(false)}
        task={editingTask}
        defaults={{ projectId: taskDefaultProject }}
      />
      <ProjectEditSheet
        open={projectSheetOpen}
        onClose={() => setProjectSheetOpen(false)}
        project={editingProject}
      />
      <FreezeSheet
        key={freezeSheetOpen ? 'freeze-open' : 'freeze-closed'}
        open={freezeSheetOpen}
        onClose={() => setFreezeSheetOpen(false)}
      />

      {draggingTask && (
        <div
          className="pointer-events-none fixed z-[70] max-w-[70vw] -translate-y-1/2 translate-x-3 truncate rounded-xl border border-border bg-elevated px-3 py-2 text-sm font-medium shadow-lg shadow-black/30 opacity-90"
          style={{ left: pointer.x, top: pointer.y }}
        >
          {draggingTask.title}
        </div>
      )}
      {draggingProject && (
        <div
          className="pointer-events-none fixed z-[70] max-w-[70vw] -translate-y-1/2 translate-x-3 truncate rounded-xl border border-accent bg-elevated px-3 py-2 text-sm font-semibold shadow-lg shadow-black/30 opacity-95"
          style={{ left: pointer.x, top: pointer.y }}
        >
          {draggingProject.emoji} {draggingProject.name}
        </div>
      )}
    </Screen>
  );
}
