import { Check } from 'lucide-react';
import { isLightColor, ON_COLOR_DARK } from '../../lib/colors';

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
  // На светлой заливке (белый, янтарный…) белая галочка не видна — ставим тёмную.
  const checkColor = color && isLightColor(color) ? ON_COLOR_DARK : '#fff';
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
        borderColor: c, // рамка цвета проекта и у пустого квадрата — видно цвет
        background: checked ? c : 'transparent',
      }}
    >
      {checked && <Check size={size - 10} color={checkColor} strokeWidth={3} />}
    </button>
  );
}
