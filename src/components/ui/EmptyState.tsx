import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  hint?: string;
}

export function EmptyState({ icon: Icon, title, hint }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <Icon size={40} className="text-muted/60" strokeWidth={1.5} />
      <p className="font-semibold text-muted">{title}</p>
      {hint && <p className="max-w-60 text-sm text-muted/70">{hint}</p>}
    </div>
  );
}
