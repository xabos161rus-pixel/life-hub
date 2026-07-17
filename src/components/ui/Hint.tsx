import type { ComponentType, ReactNode } from 'react';
import { Lightbulb, X } from 'lucide-react';
import { useHint } from '../../hooks/useHint';

export interface HintItem {
  icon: ComponentType<{ size?: number | string; className?: string }>;
  text: ReactNode;
}

/** Карточка-подсказка: одноразовый совет в контексте раздела, скрывается
 *  крестиком навсегда (useHint / settings.seenHints).
 *
 *  Структурированный вид: заголовок + пункты, каждый со своей мини-иконкой —
 *  читается по строкам, а не сплошным абзацем. children остаётся для
 *  коротких подсказок в одну мысль. */
export function Hint({
  id,
  title,
  items,
  className = '',
  children,
}: {
  id: string;
  title?: string;
  items?: HintItem[];
  className?: string;
  children?: ReactNode;
}) {
  const { visible, dismiss } = useHint(id);
  if (!visible) return null;
  return (
    <div
      className={`animate-fade-in rounded-2xl border border-accent/20 bg-accent/[0.07] px-3.5 py-3 text-[13px] leading-snug ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Lightbulb size={13} />
        </span>
        <span className="min-w-0 flex-1 font-semibold tracking-tight text-text">
          {title ?? 'Подсказка'}
        </span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Скрыть подсказку"
          className="-m-1 shrink-0 p-1 text-muted active:opacity-60"
        >
          <X size={15} />
        </button>
      </div>
      {items && items.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {items.map((it, i) => {
            const Icon = it.icon;
            return (
              <li key={i} className="flex items-start gap-2.5">
                <Icon size={14} className="mt-0.5 shrink-0 text-accent/80" />
                <span className="min-w-0 flex-1 text-text/85">{it.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {children && <div className="mt-1.5 pl-8 text-text/85">{children}</div>}
    </div>
  );
}
