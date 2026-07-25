import { useEffect, useState } from 'react';

/** Куда пользователь ведёт ленту: 'down' — уводит контент вверх (читает дальше). */
export type ScrollDirection = 'up' | 'down';

/** Палец физически не держит список неподвижно, и инерция iOS «дожимает» ленту
 *  на пару пикселей после отпускания. Без порога кнопка мигала бы на каждом
 *  таком микросдвиге. 8px — заметное для человека движение, но выше дрожания. */
const THRESHOLD = 8;

/** У самого верха прятать нечего: перекрывать там нечего, а после смены
 *  маршрута лента сбрасывается наверх (ScrollReset в App.tsx) — кнопка обязана
 *  вернуться, даже если жест до этого был «вниз». */
const TOP_ZONE = 16;

/**
 * Направление прокрутки ленты #app-scroll — единственного скролл-контейнера
 * приложения (объявлен в App.tsx; сама страница не скроллится, каркас fixed
 * inset-0). Нужен плавающей кнопке: стоя в одной точке экрана, она перекрывала
 * то, что оказывалось под ней (карандаш «Изменить раздел» на «Сегодня» — тап
 * открывал «Новая задача», сегмент «Год» в Финансах), поэтому при движении
 * вниз уходит с дороги и возвращается при движении вверх.
 *
 * Если контента мало и лента не прокручивается, событий не приходит вовсе —
 * значение остаётся 'up', и кнопка всё время на месте.
 */
export function useScrollDirection(): ScrollDirection {
  const [direction, setDirection] = useState<ScrollDirection>('up');

  useEffect(() => {
    const el = document.getElementById('app-scroll');
    if (!el) return;
    let last = el.scrollTop;

    const onScroll = () => {
      const top = el.scrollTop;
      if (top <= TOP_ZONE) {
        last = top;
        setDirection('up');
        return;
      }
      const delta = top - last;
      if (Math.abs(delta) < THRESHOLD) return;
      // Точку отсчёта двигаем только на засчитанном жесте: иначе медленная
      // прокрутка по 2-3px за событие никогда не набрала бы порог.
      last = top;
      setDirection(delta > 0 ? 'down' : 'up');
    };

    // passive: обработчик не зовёт preventDefault, и браузеру не нужно ждать
    // его перед прокруткой — иначе лента теряет кадры на каждом событии.
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return direction;
}
