import type { ReactNode } from 'react';

interface Props {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function Chip({ active = false, onClick, children }: Props) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? // Сплошная заливка, а не подложка того же цвета: акцентный текст на
            // акцентной подложке упирается в 3.3:1 и выше не поднимается —
            // фон подтягивается к цвету текста, сколько его ни ослабляй.
            // Заодно выбранный фильтр теперь видно с одного взгляда.
            'border-accent-fill bg-accent-fill text-white'
          : 'border-border bg-surface text-muted'
      }`}
    >
      {children}
    </button>
  );
}

/** Горизонтальная прокручиваемая полоса чипов. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}
