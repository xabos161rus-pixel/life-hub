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
const MOVE_THRESHOLD = 6; // сдвиг, отличающий перетаскивание от тапа

/** Загоняет позицию кнопки в видимую область под текущий размер экрана —
 *  чтобы сохранённое место не увело её за край при повороте/смене устройства. */
function clampToViewport(x: number, y: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = Math.max(EDGE, vw - FAB_SIZE - EDGE);
  const maxY = Math.max(TOP_GAP, vh - FAB_SIZE - BOTTOM_GAP);
  return { x: Math.min(Math.max(x, EDGE), maxX), y: Math.min(Math.max(y, TOP_GAP), maxY) };
}

/** Плавающая кнопка добавления. По умолчанию — над таб-баром справа, с акцентным
 *  свечением. Её можно перетащить в любое удобное место: позиция хранится в
 *  settings (device-local), у каждого человека своя. Короткий тап без сдвига —
 *  это нажатие (открыть добавление); заметное перетаскивание — перенос кнопки.
 *  При дефолтной позиции поднимается выше мини-помодоро и install-баннера. */
export function Fab({ onClick, label = 'Добавить' }: Props) {
  const { active } = usePomodoro();
  const banner = useInstallBannerVisible();
  const settings = useSettings();
  const saved = settings.fabPosition ?? null;

  // Живая позиция во время перетаскивания. null — сейчас не тащим.
  const [live, setLive] = useState<{ x: number; y: number } | null>(null);
  const g = useRef({ down: false, moved: false, offX: 0, offY: 0, sx: 0, sy: 0, pointerId: 0 });
  const ref = useRef<HTMLButtonElement>(null);

  const bottom = banner
    ? 'bottom-[calc(env(safe-area-inset-bottom)+176px)]'
    : active
      ? 'bottom-[calc(env(safe-area-inset-bottom)+128px)]'
      : 'bottom-[calc(env(safe-area-inset-bottom)+80px)]';

  // Куда рисуем: тащим (live) → сохранённая (клампится под экран) → дефолт (right/bottom).
  const pos = live ?? (saved ? clampToViewport(saved.x, saved.y) : null);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    g.current = {
      down: true,
      moved: false,
      offX: e.clientX - r.left, // где внутри кнопки взялись — чтобы не прыгала под палец
      offY: e.clientY - r.top,
      sx: e.clientX,
      sy: e.clientY,
      pointerId: e.pointerId,
    };
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже неактивен */
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!g.current.down) return;
    if (
      !g.current.moved &&
      Math.hypot(e.clientX - g.current.sx, e.clientY - g.current.sy) < MOVE_THRESHOLD
    ) {
      return; // ещё в пределах тапа — не начинаем перетаскивание
    }
    g.current.moved = true;
    setLive(clampToViewport(e.clientX - g.current.offX, e.clientY - g.current.offY));
  };
  const finish = (e: PointerEvent<HTMLButtonElement>) => {
    if (!g.current.down) return;
    g.current.down = false;
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* уже отпущен */
    }
    if (g.current.moved && live) void updateSettings({ fabPosition: live });
    setLive(null);
  };
  const handleClick = () => {
    if (g.current.moved) {
      g.current.moved = false;
      return; // это было перетаскивание, а не нажатие
    }
    onClick();
  };

  return (
    <button
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onClick={handleClick}
      aria-label={label}
      style={{
        backgroundImage: 'linear-gradient(140deg, var(--app-accent), var(--app-accent-2))',
        touchAction: 'none', // касание кнопки не скроллит страницу — тащим её саму
        ...(pos ? { left: pos.x, top: pos.y } : {}),
      }}
      // right/bottom (дефолт) держат кнопку у края центральной колонки max-w-lg;
      // при своей позиции переходим на left/top. Во время перетаскивания плавность
      // выключаем, чтобы кнопка не отставала от пальца.
      className={`fixed z-40 flex size-14 items-center justify-center rounded-full text-white shadow-[var(--shadow-accent)] active:scale-90 ${
        pos
          ? live
            ? ''
            : 'transition-transform duration-200'
          : `right-[max(1.25rem,calc(50vw-16rem))] ${bottom} transition-[transform,bottom] duration-200`
      }`}
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>
  );
}
