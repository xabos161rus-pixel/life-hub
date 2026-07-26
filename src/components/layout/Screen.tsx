import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { HIT_SLOP_44 } from '../ui/hitSlop';

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
 *  нет, внизу висела мёртвая полоса высотой почти с таб-бар.
 *
 *  16px в max() — нижняя граница этого отступа. Без неё на маршрутах без кнопки
 *  --fab-space равнялся 0px, и последняя карточка упиралась в таб-бар вплотную
 *  (замеры: зазор 0.0-0.3px, на 375px даже -0.5/-0.8px — нижний бордер срезался
 *  краем скролл-контейнера, потому что при root 17px размеры дробные и низ ленты
 *  попадает между пикселями). Плюс тень карточки (0 8px 24px -12px) рисуется
 *  ниже бордера и без запаса обрезалась целиком.
 *  max(), а не сумма: с кнопкой её клиренс уже больше воздуха, и складывать их
 *  значило бы вернуть ту самую мёртвую полосу. Значение вписано литералом —
 *  Tailwind ищет классы по тексту исходника, из шаблонной строки с константой
 *  утилита просто не сгенерировалась бы.
 *  Высоту таб-бара и safe-area сюда НЕ добавляем сознательно: таб-бар —
 *  соседний flex-элемент каркаса (App.tsx), а не наложение, свою safe-area он
 *  держит сам; контент физически заканчивается на его верхней границе. */
export function Screen({ title, backTo, right, subtitle, fill = false, children }: Props) {
  return (
    <div className={fill ? 'flex h-full flex-col' : 'min-h-full pb-[max(16px,var(--fab-space,0px))]'}>
      {/* Широкие экраны (Mac/Windows/iPad): контент — центральная колонка
          max-w-lg, той же ширины, что таб-бар. На телефоне ничего не меняет. */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-hairline bg-bg px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
        <div className="mx-auto flex w-full max-w-lg items-center gap-2">
          {backTo && (
            <Link
              to={backTo}
              aria-label="Назад"
              className={`-ml-2 p-1 text-accent active:opacity-60 ${HIT_SLOP_44}`}
            >
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
            <h1 className="line-clamp-2 text-[clamp(23px,7.5vw,27px)] leading-[1.15] font-bold tracking-tight break-words">
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
