import { useRef, useState, type PointerEvent } from 'react';
import { Plus } from 'lucide-react';
import { usePomodoro } from '../../features/focus/PomodoroProvider';
import { useInstallBannerVisible } from '../../hooks/useInstallBanner';
import { useSettings, updateSettings } from '../../hooks/useSettings';

interface Props {
  onClick: () => void;
  label?: string;
}

const FAB_SIZE = 56; // size-14 (3.5rem)
const EDGE = 12; // отступ от боковых краёв
const TOP_GAP = 76; // не заходить под шапку
const BOTTOM_GAP = 96; // не заходить под таб-бар (+ запас на safe-area)
const LONG_PRESS_MS = 450; // удержание без ухода пальца → режим перетаскивания
const CANCEL_MOVE = 10; // уход пальца до срабатывания удержания = не перетаскивание

/** Загоняет позицию кнопки в видимую область под текущий размер экрана —
 *  чтобы сохранённое место не увело её за край при повороте/смене устройства. */
function clampToViewport(x: number, y: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = Math.max(EDGE, vw - FAB_SIZE - EDGE);
  const maxY = Math.max(TOP_GAP, vh - FAB_SIZE - BOTTOM_GAP);
  return { x: Math.min(Math.max(x, EDGE), maxX), y: Math.min(Math.max(y, TOP_GAP), maxY) };
}

/** Плавающая кнопка добавления. Короткий тап — нажатие (открыть добавление).
 *  Удержание ~0.45с включает режим перетаскивания (кнопка приподнимается) —
 *  дальше тащишь её в любое удобное место. Так согласуется с переносом задач и
 *  проектов (тоже удержанием) и исключает случайный сдвиг при обычном нажатии.
 *  Позиция хранится в settings (device-local) — у каждого человека своя.
 *  Во время переноса двигаем через transform (без reflow) — движение плавное.
 *  При дефолтной позиции кнопка поднимается выше мини-помодоро и install-баннера. */
export function Fab({ onClick, label = 'Добавить' }: Props) {
  const { active } = usePomodoro();
  const banner = useInstallBannerVisible();
  const settings = useSettings();
  const saved = settings.fabPosition ?? null;

  const [dragging, setDragging] = useState(false);
  // Позиция, применённая сразу после переноса — чтобы кнопка не мигнула в момент
  // между отпусканием и синком с settings. null — берём из settings (или дефолт).
  const [override, setOverride] = useState<{ x: number; y: number } | null>(null);

  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const g = useRef({
    armed: false, // палец опущен, ждём удержание
    dragMode: false, // удержание сработало — тащим
    moved: false, // было реальное перемещение
    wasDrag: false, // подавить click после режима перетаскивания
    sx: 0,
    sy: 0,
    baseX: 0,
    baseY: 0,
    curX: 0,
    curY: 0,
    pointerId: 0,
  });

  const bottom = banner
    ? 'bottom-[calc(env(safe-area-inset-bottom)+176px)]'
    : active
      ? 'bottom-[calc(env(safe-area-inset-bottom)+128px)]'
      : 'bottom-[calc(env(safe-area-inset-bottom)+80px)]';

  // Куда рисуем: только что перенесли (override) → сохранённая (клампится под
  // экран) → дефолт (right/bottom). Во время переноса left/top остаются базой,
  // а смещение идёт через transform.
  const pos = override ?? (saved ? clampToViewport(saved.x, saved.y) : null);

  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const releaseCapture = () => {
    try {
      ref.current?.releasePointerCapture(g.current.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    g.current = {
      armed: true,
      dragMode: false,
      moved: false,
      wasDrag: false,
      sx: e.clientX,
      sy: e.clientY,
      baseX: r.left,
      baseY: r.top,
      curX: r.left,
      curY: r.top,
      pointerId: e.pointerId,
    };
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже неактивен */
    }
    clearTimer();
    timer.current = setTimeout(() => {
      if (!g.current.armed) return;
      g.current.dragMode = true;
      g.current.wasDrag = true;
      try {
        navigator.vibrate?.(10); // тактильный сигнал «взял» (где поддерживается)
      } catch {
        /* без вибрации */
      }
      setDragging(true);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = g.current;
    if (!s.armed) return;
    if (!s.dragMode) {
      // Ждём удержание. Заметный сдвиг раньше времени = не перетаскивание: отменяем
      // (и глушим последующий click, чтобы свайп по кнопке не добавил задачу).
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > CANCEL_MOVE) {
        clearTimer();
        s.armed = false;
        s.wasDrag = true;
        releaseCapture();
      }
      return;
    }
    const clamped = clampToViewport(s.baseX + (e.clientX - s.sx), s.baseY + (e.clientY - s.sy));
    s.curX = clamped.x;
    s.curY = clamped.y;
    s.moved = true;
    // Императивно, без ре-рендера: transform не вызывает reflow — движение плавное.
    if (ref.current) {
      ref.current.style.transform = `translate(${clamped.x - s.baseX}px, ${clamped.y - s.baseY}px)`;
    }
  };

  const onPointerUp = () => {
    const s = g.current;
    clearTimer();
    releaseCapture();
    if (s.dragMode) {
      if (ref.current) ref.current.style.transform = '';
      if (s.moved) {
        const final = { x: s.curX, y: s.curY };
        setOverride(final);
        void updateSettings({ fabPosition: final });
      }
      setDragging(false);
    }
    s.armed = false;
    s.dragMode = false;
  };

  const handleClick = () => {
    if (g.current.wasDrag) {
      g.current.wasDrag = false;
      return; // был режим перетаскивания / отменённый свайп — не нажатие
    }
    onClick();
  };

  return (
    <button
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={handleClick}
      aria-label={label}
      style={{
        backgroundImage: 'linear-gradient(140deg, var(--app-accent), var(--app-accent-2))',
        touchAction: 'none', // касание кнопки не скроллит страницу — тащим её саму
        ...(pos ? { left: pos.x, top: pos.y } : {}),
        ...(dragging ? { willChange: 'transform' } : {}),
      }}
      // Позиция: right/bottom (дефолт) или left/top (своя). Плавность (transition)
      // выключаем на время переноса, иначе она «догоняет» transform и кнопка
      // дёргается. active:scale-90 — только вне переноса (в переносе кнопка
      // приподнята scale-105, иначе :active мигал бы при движении пальца).
      className={`fixed z-40 flex size-14 items-center justify-center rounded-full text-white shadow-[var(--shadow-accent)] ${
        pos ? '' : `right-[max(1.25rem,calc(50vw-16rem))] ${bottom}`
      } ${dragging ? 'scale-105 shadow-2xl' : 'active:scale-90'} ${
        dragging
          ? ''
          : pos
            ? 'transition-transform duration-200'
            : 'transition-[transform,bottom] duration-200'
      }`}
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>
  );
}
