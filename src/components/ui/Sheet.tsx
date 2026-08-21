import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  GClose as X,
} from '../../components/ui/glyphs';
import { t } from '../../lib/i18n';
import { HIT_SLOP_44 } from './hitSlop';
import { ICON } from '../../components/ui/icons';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Протянул дальше этого порога (px) — закрываем. */
const CLOSE_DISTANCE = 100;
/** Быстрый флик вниз (px/мс) — закрываем независимо от расстояния. */
const FLICK_VELOCITY = 0.55;

/** Bottom sheet — стандартный контейнер быстрых форм создания/редактирования.
 *  Закрывается свайпом вниз по «ручке»/шапке. */
export function Sheet({ open, onClose, title, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Текущее смещение панели за пальцем; null — drag не активен (нет transform).
  const [dragY, setDragY] = useState<number | null>(null);
  // Сведения о текущем жесте для расчёта скорости и delta; вне state, чтобы не дёргать рендер.
  const gesture = useRef<{ startY: number; lastY: number; lastT: number; velocity: number } | null>(
    null,
  );

  // При открытии сбрасываем прокрутку шита наверх — формы открываются с верха,
  // а не «доскроленными» вниз (баг iOS с автофокусом/восстановлением скролла).
  useEffect(() => {
    if (open) {
      gesture.current = null;
      panelRef.current?.scrollTo({ top: 0 });
    }
  }, [open]);

  if (!open) return null;

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    // Жест начинаем только когда контент прокручен к самому верху,
    // иначе свайп вниз — это обычная прокрутка.
    if ((panelRef.current?.scrollTop ?? 0) > 0) return;
    gesture.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g) return;
    const dy = e.clientY - g.startY;
    // Тянем только вниз; вверх не уводим (резинка только в одну сторону).
    const next = dy > 0 ? dy : 0;
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.velocity = (e.clientY - g.lastY) / dt;
    g.lastY = e.clientY;
    g.lastT = e.timeStamp;
    setDragY(next);
  }

  function handlePointerUp() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const travelled = g.lastY - g.startY;
    if (travelled > CLOSE_DISTANCE || g.velocity > FLICK_VELOCITY) {
      // Сброс смещения делаем здесь, а не в эффекте открытия: иначе панель
      // при следующем открытии осталась бы сдвинутой на величину свайпа.
      setDragY(null);
      onClose();
    } else {
      // Пружинит обратно: transition включается только на отпускании.
      setDragY(null);
    }
  }

  const dragging = dragY !== null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={onClose} />
      <div
        ref={panelRef}
        className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-lg animate-sheet-up overflow-y-auto rounded-t-[1.6rem] border-t border-hairline bg-elevated pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-[var(--shadow-pop)]"
        style={
          dragging
            ? { transform: `translateY(${dragY}px)`, transition: 'none' }
            : // Пустой transform держит панель на месте и даёт пружину обратно
              // после drag, не перезапуская keyframe-анимацию входа.
              { transform: 'translateY(0)', transition: 'transform 0.2s ease-out' }
        }
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="sticky top-0 z-10 cursor-grab touch-none bg-elevated px-4 pt-2.5 pb-2 active:cursor-grabbing"
        >
          <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-muted/40" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{title}</h2>
            {/* Крестик остаётся мелким (30px): визуально он служебный и
                раздувать его незачем. А вот зону касания псевдоэлемент
                добирает до 44×44 — палец мимо служебной кнопки промахивается
                ровно так же, как мимо главной. Ограничение hitSlop про 11px
                между соседями соблюдено: рядом с крестиком ничего нет. */}
            <button
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={t('Закрыть')}
              className={`rounded-full bg-surface-2 p-1.5 text-muted transition-transform active:scale-90 ${HIT_SLOP_44}`}
            >
              <X size={ICON.base} />
            </button>
          </div>
        </div>
        <div className="px-4 pt-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
