import { Check } from 'lucide-react';

interface Props {
  checked: boolean;
  onChange: () => void;
  /** hex-цвет проекта/привычки; по умолчанию акцентный */
  color?: string;
  size?: number;
}

/** Круглый чекбокс задачи в стиле iOS Reminders. */
export function TaskCheck({ checked, onChange, color, size = 26 }: Props) {
  const c = color || 'var(--app-accent)';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      aria-label={checked ? 'Снять отметку' : 'Выполнить'}
      className="flex shrink-0 items-center justify-center rounded-full border-2 transition-transform duration-150 active:scale-90"
      style={{
        width: size,
        height: size,
        borderColor: c,
        background: checked ? c : 'transparent',
      }}
    >
      {checked && <Check size={size - 12} color="#fff" strokeWidth={3.5} />}
    </button>
  );
}
