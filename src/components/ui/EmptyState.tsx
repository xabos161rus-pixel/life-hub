import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  hint?: string;
}

/** Заглушка пустого списка. Отступы асимметричны намеренно: сверху меньше, чтобы
 *  блок ушёл выше зоны плавающей «+» (она fixed у нижнего правого края и на
 *  коротком экране накрывала подсказку), снизу — резерв под саму кнопку через
 *  --fab-space (0 на экранах без неё), чтобы под текстом всегда оставался запас
 *  прокрутки и подсказку можно было вывести из-под кнопки. */
export function EmptyState({ icon: Icon, title, hint }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 pt-14 pb-[calc(2rem+var(--fab-space,0px))] text-center">
      <div className="card flex size-16 items-center justify-center text-muted">
        <Icon size={28} />
      </div>
      <p className="text-base font-semibold">{title}</p>
      {hint && <p className="max-w-64 text-sm leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}
