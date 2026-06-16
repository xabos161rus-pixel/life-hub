import { Check } from 'lucide-react';

interface Props {
  checked: boolean;
  onChange: () => void;
  /** hex-цвет проекта/привычки; по умолчанию акцентный */
  color?: string;
  size?: number;
}

/** Чекбокс задачи — скруглённый квадрат (как в списках iOS). Пустой —
 *  спокойная серая рамка; выполненный — заливка цветом проекта/акцента
 *  и белая галочка. Лаконичнее прежнего крупного цветного кольца. */
export function TaskCheck({ checked, onChange, color, size = 22 }: Props) {
  const c = color || 'var(--app-accent)';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      aria-label={checked ? 'Снять отметку' : 'Выполнить'}
      className="flex shrink-0 items-center justify-center rounded-[6px] border-[1.5px] transition-transform duration-150 active:scale-90"
      style={{
        width: size,
        height: size,
        borderColor: checked ? c : 'var(--app-border)',
        background: checked ? c : 'transparent',
      }}
    >
      {checked && <Check size={size - 10} color="#fff" strokeWidth={3} />}
    </button>
  );
}
