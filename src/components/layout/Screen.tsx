import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { ICON, STROKE_STRONG } from '../ui/icons';

interface Props {
  title: string;
  /** маршрут «назад»; если задан — слева появляется стрелка */
  backTo?: string;
  /** Выход «назад» для экранов, которые не маршрут, а состояние внутри
   *  страницы (перенос заметки в папку). Для них backTo не годится: ссылка на
   *  собственный адрес компонент не размонтирует, состояние остаётся, и
   *  стрелка выглядит рабочей, ничего не делая. */
  onBack?: () => void;
  /** Подпись рядом со стрелкой — КУДА она ведёт: «Заметки», имя папки.
   *
   *  Нужна экранам без собственного заголовка. У редактора заметки его роль
   *  играет первая строка текста, поэтому title пустой, — и в шапке оставалась
   *  одна голая стрелка без единого слова. В iOS на этом месте всегда стоит имя
   *  родителя («‹ Все заметки»): оно и объясняет, куда вернёшься, и не спорит с
   *  заголовком самой заметки, потому что набрано обычным кеглем. */
  backLabel?: string;
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
/** Стрелка «Назад» с необязательной подписью. */
function BackControl({ to, onClick, label }: { to?: string; onClick?: () => void; label?: string }) {
  if (!label) {
    return (
      <IconButton
        icon={ChevronLeft}
        label="Назад"
        {...(onClick ? { onClick } : { to })}
        size={ICON.accent}
        strokeWidth={STROKE_STRONG}
      />
    );
  }
  // -ml-1 повторяет отступ IconButton: без него подписанная стрелка стояла бы
  // на 4px правее обычной, и шапка прыгала бы при переходе между экранами.
  const cls =
    'relative -ml-1 flex min-h-11 shrink-0 items-center gap-0.5 pr-1 text-accent active:opacity-60';
  const inner = (
    <>
      <ChevronLeft size={ICON.accent} strokeWidth={STROKE_STRONG} className="shrink-0" />
      {/* max-w — чтобы длинное имя папки не съедало место у кнопок справа. */}
      <span className="max-w-[7.5rem] truncate">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" aria-label={`Назад: ${label}`} onClick={onClick} className={cls}>
      {inner}
    </button>
  ) : (
    <Link to={to!} aria-label={`Назад: ${label}`} className={cls}>
      {inner}
    </Link>
  );
}

export function Screen({
  title,
  backTo,
  onBack,
  backLabel,
  right,
  subtitle,
  fill = false,
  children,
}: Props) {
  return (
    <div className={fill ? 'flex h-full flex-col' : 'min-h-full pb-[max(16px,var(--fab-space,0px))]'}>
      {/* Широкие экраны (Mac/Windows/iPad): контент — центральная колонка
          max-w-lg, той же ширины, что таб-бар. На телефоне ничего не меняет. */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-hairline bg-bg px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-3">
        <div className="mx-auto flex w-full max-w-lg items-center gap-2">
          {/* Стрелка «Назад» — единственная навигация вверх по иерархии, и вес
              у неё акцентный: обычным 1.5px шеврон рядом с жирным заголовком
              читался как случайная чёрточка. В iOS он тоже полужирный. */}
          {(backTo || onBack) && (
            // Стрелка и подпись — одна кнопка, а не две рядом стоящие: в iOS
            // «‹ Заметки» нажимается целиком, и палец туда и целится.
            <BackControl to={backTo} onClick={onBack} label={backLabel} />
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
            {/* Пустой заголовок — законный случай: у редактора заметки его
                роль играет первая строка самого текста, и дублировать её
                словом «Заметка» незачем. Рендерить пустой h1 нельзя — он
                занимает высоту строки и раздувает шапку. */}
            {title && (
              <h1 className="line-clamp-2 text-[clamp(23px,7.5vw,27px)] leading-[1.15] font-bold tracking-tight break-words">
                {title}
              </h1>
            )}
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
