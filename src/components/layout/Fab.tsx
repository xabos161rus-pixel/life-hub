import { Plus } from 'lucide-react';

interface Props {
  onClick: () => void;
  label?: string;
}

/** Плавающая кнопка добавления — над таб-баром справа. */
export function Fab({ onClick, label = 'Добавить' }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-40 flex size-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-black/30 active:scale-95 transition-transform"
    >
      <Plus size={28} />
    </button>
  );
}
