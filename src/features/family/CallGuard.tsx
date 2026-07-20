import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronsRight, Lock } from 'lucide-react';
import { clampKnob, slidUnlocked } from './callGuardMath';

/** Ширина ползунка (px) — синхронно с размером кнопки-ручки в разметке. */
const KNOB = 56;

/**
 * «Защита от щеки» — непрозрачный слой поверх управления во время активного
 * звонка «к уху». На вебе (особенно iOS-PWA) нет доступа к датчику приближения
 * и нельзя погасить экран, поэтому щека жмёт кнопки. Слой перехватывает все
 * касания: щека рождает тычки, а не осознанный горизонтальный свайп, поэтому
 * снять блокировку случайно нельзя — только сознательно провести ползунок.
 */
export function CallGuard({
  peerName,
  elapsed,
  onUnlock,
}: {
  peerName: string;
  elapsed: string;
  onUnlock: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [offset, setOffset] = useState(0);

  const maxOffset = () => Math.max(0, (trackRef.current?.clientWidth ?? 0) - KNOB);

  function onDown(e: ReactPointerEvent) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: ReactPointerEvent) {
    if (!draggingRef.current || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    setOffset(clampKnob(e.clientX - rect.left - KNOB / 2, 0, maxOffset()));
  }
  function onUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (slidUnlocked(offset, maxOffset())) onUnlock();
    setOffset(0);
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex select-none flex-col items-center justify-between bg-bg px-6 pt-[calc(env(safe-area-inset-top)+72px)] pb-[calc(env(safe-area-inset-bottom)+40px)]"
      // Слой сознательно съедает касания — под ним кнопки, до которых щека
      // теперь не дотянется. Кроме ползунка, тапы никуда не ведут.
    >
      {/* Кто и сколько — чтобы было видно, что звонок идёт */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Lock size={26} />
        </span>
        <p className="text-xl font-semibold">{peerName}</p>
        <p className="text-sm text-muted">На связи · {elapsed}</p>
        <p className="mt-1 text-sm text-muted">Экран заблокирован, чтобы не нажать щекой</p>
      </div>

      {/* Провести, чтобы показать управление */}
      <div
        ref={trackRef}
        className="relative h-14 w-full max-w-xs touch-none overflow-hidden rounded-full bg-surface-2"
      >
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center pr-6 text-sm font-medium text-muted">
          Проведите, чтобы разблокировать
        </span>
        <button
          type="button"
          aria-label="Разблокировать управление"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{ transform: `translateX(${offset}px)` }}
          className="absolute top-1 left-1 flex size-12 touch-none items-center justify-center rounded-full bg-accent text-white shadow-lg active:scale-95"
        >
          <ChevronsRight size={24} />
        </button>
      </div>
    </div>
  );
}
