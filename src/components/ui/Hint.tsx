import type { ReactNode } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useHint } from '../../hooks/useHint';

/** Карточка-подсказка с лампочкой: одноразовый совет в контексте раздела.
 *  Скрывается крестиком навсегда (useHint / settings.seenHints). */
export function Hint({
  id,
  className = '',
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { visible, dismiss } = useHint(id);
  if (!visible) return null;
  return (
    <div
      className={`flex animate-fade-in items-start gap-2 rounded-xl border border-accent/25 bg-accent/10 px-3 py-2.5 text-[13px] leading-snug ${className}`}
    >
      <Lightbulb size={15} className="mt-px shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-text/90">{children}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Скрыть подсказку"
        className="-m-1 shrink-0 p-1 text-muted active:opacity-60"
      >
        <X size={14} />
      </button>
    </div>
  );
}
