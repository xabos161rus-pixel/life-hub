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
  /** контент занимает всю высоту (для чата): сам скроллится внутри, без резерва снизу */
  fill?: boolean;
  children: ReactNode;
}

/** Каркас страницы: липкая шапка с safe-area + контент с нижним отступом ровно
 *  под клиренс FAB (таб-бар — отдельный flex-элемент, контент под него не уходит,
 *  поэтому большой pb не нужен — он давал пустую полосу внизу в standalone).
 *
 *  Отступ условный: --fab-space выставляет сама плавающая кнопка на время своей
 *  жизни (см. Fab.tsx), fallback 0px — для экранов без неё. Раньше здесь стоял
 *  безусловный pb-20 (85px при root 17px), и на 11 маршрутах из 20, где кнопки
 *  нет, внизу висела мёртвая полоса высотой почти с таб-бар. */
export function Screen({ title, backTo, right, subtitle, fill = false, children }: Props) {
  return (
    <div className={fill ? 'flex h-full flex-col' : 'min-h-full pb-[var(--fab-space,0px)]'}>
      {/* Широкие экраны (Mac/Windows/iPad): контент — центральная колонка
          max-w-lg, той же ширины, что таб-бар. На телефоне ничего не меняет. */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-hairline bg-bg px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
        <div className="mx-auto flex w-full max-w-lg items-center gap-2">
          {backTo && (
            <Link to={backTo} aria-label="Назад" className="-ml-2 p-1 text-accent active:opacity-60">
              <ChevronLeft size={26} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            {/* Заголовок переносится на вторую строку вместо обрезки многоточием
                («Установка и данн…»): на 320px под него остаётся всего ~252px —
                ширина минус px-4 и стрелка «Назад». line-clamp-2 оставляет
                многоточие только для действительно длинных названий, break-words
                страхует от неразрывно длинного слова (у шапки overflow скрыт).
                Размер: 27px — задумка автора, держим его от 360px и выше (все
                актуальные телефоны); 7.5vw ужимает только совсем узкие экраны
                (320px → 24px), где две строки уже не спасают. */}
            <h1 className="line-clamp-2 text-[clamp(23px,7.5vw,27px)] font-bold tracking-[-0.02em] break-words">
              {title}
            </h1>
            {subtitle && <p className="text-sm font-medium text-muted">{subtitle}</p>}
          </div>
          {right}
        </div>
      </header>
      <main
        className={
          fill
            ? 'mx-auto min-h-0 w-full max-w-lg flex-1 overflow-hidden px-4 pt-4'
            : 'mx-auto w-full max-w-lg px-4 pt-4'
        }
      >
        {children}
      </main>
    </div>
  );
}
