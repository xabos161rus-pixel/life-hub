interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <div className="flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium transition-all duration-200 ${
            value === o.value
              ? 'bg-accent text-white shadow-[0_2px_10px_-3px_var(--app-accent)]'
              : 'text-muted active:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
