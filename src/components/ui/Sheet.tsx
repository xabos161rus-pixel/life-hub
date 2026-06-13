import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Bottom sheet — стандартный контейнер быстрых форм создания/редактирования. */
export function Sheet({ open, onClose, title, children }: Props) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] animate-sheet-up overflow-y-auto rounded-t-[1.6rem] border-t border-hairline bg-elevated pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-[var(--shadow-pop)]">
        <div className="sticky top-0 z-10 bg-elevated px-4 pt-2.5 pb-2">
          <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-muted/40" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              className="rounded-full bg-surface-2 p-1.5 text-muted transition-transform active:scale-90"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="px-4 pt-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
