import { Plus } from 'lucide-react';

interface Props {
  onClick: () => void;
  label?: string;
}

/** Плавающая кнопка добавления — над таб-баром справа, с акцентным свечением. */
export function Fab({ onClick, label = 'Добавить' }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        backgroundImage: 'linear-gradient(140deg, var(--app-accent), var(--app-accent-2))',
      }}
      className="fixed right-5 bottom-[calc(env(safe-area-inset-bottom)+80px)] z-40 flex size-14 items-center justify-center rounded-full text-white shadow-[var(--shadow-accent)] transition-transform duration-200 active:scale-90"
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>
  );
}
