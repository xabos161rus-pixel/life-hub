import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';

interface Props {
  title: string;
  /** маршрут «назад»; если задан — слева появляется стрелка */
  backTo?: string;
  /** слот справа в шапке (кнопки) */
  right?: ReactNode;
  /** подзаголовок под title (например, дата) */
  subtitle?: string;
  children: ReactNode;
}

/** Каркас страницы: липкая шапка с safe-area + контент с отступом под таб-бар. */
export function Screen({ title, backTo, right, subtitle, children }: Props) {
  return (
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)+100px)]">
      <header className="sticky top-0 z-30 border-b border-hairline bg-bg/70 px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          {backTo && (
            <Link to={backTo} aria-label="Назад" className="-ml-2 p-1 text-accent active:opacity-60">
              <ChevronLeft size={26} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[27px] font-bold tracking-[-0.02em]">{title}</h1>
            {subtitle && <p className="text-sm font-medium text-muted">{subtitle}</p>}
          </div>
          {right}
        </div>
      </header>
      <main className="px-4 pt-4">{children}</main>
    </div>
  );
}
