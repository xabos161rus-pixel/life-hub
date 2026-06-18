import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  hint?: string;
}

export function EmptyState({ icon: Icon, title, hint }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <div className="card flex size-16 items-center justify-center text-muted">
        <Icon size={28} />
      </div>
      <p className="text-base font-semibold">{title}</p>
      {hint && <p className="max-w-64 text-sm leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}
