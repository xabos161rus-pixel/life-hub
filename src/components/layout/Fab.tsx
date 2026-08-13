import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import {
  GPlus as Plus,
} from '../../components/ui/glyphs';
import { usePomodoro } from '../../features/focus/pomodoro';
import { useSettings, updateSettings } from '../../hooks/useSettings';
import { useScrollDirection } from '../../hooks/useScrollDirection';
import { t } from '../../lib/i18n';
import { ICON, STROKE_HEAVY } from '../ui/icons';

interface Props {
  onClick: () => void;
  label?: string;
}

const FAB_SIZE = 56; // size-14 (3.5rem)
const EDGE = 12; // отступ от боковых краёв
const TOP_GAP = 76; // не заходить под шапку
const BOTTOM_GAP = 96; // не заходить под таб-бар (+ запас на safe-area)
const TIMER_SPACE = 48; // мини-помодоро — полоска над таб-баром
const LONG_PRESS_MS = 450; // удержание без ухода пальца → режим перетаскивания
const CANCEL_MOVE = 10; // уход пальца до срабатывания удержания = не перетаскивание
/** Сколько кнопка резервирует под собой в контенте (совпадает с прежним pb-20). */
const FAB_SPACE = '5rem';

/** Держит кнопку в допустимой зоне во время переноса (и, значит, в том виде, в
 *  каком позиция уходит в settings): не под шапку, не за боковые края и не под
 *  таб-бар. reserve — полоска мини-помодоро сверх таб-бара. Границы уже отрисованной
 *  кнопки повторяет CSS-clamp в style — он переживает поворот без ре-рендера. */
function clampToViewport(x: number, y: number, reserve: number): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxX = Math.max(EDGE, vw - FAB_SIZE - EDGE);
  const maxY = Math.max(TOP_GAP, vh - FAB_SIZE - BOTTOM_GAP - reserve);
  return { x: Math.min(Math.max(x, EDGE), maxX), y: Math.min(Math.max(y, TOP_GAP), maxY) };
}

// Сколько кнопок сейчас на экране. При смене маршрута React сначала прогоняет
// все cleanup, потом все эффекты, поэтому счётчик на мгновение падает в 0 и
// сразу возвращается в 1 — резерв не залипает и не пропадает между страницами.
let mounted = 0;

/** Плавающая кнопка добавления. Короткий тап — нажатие (открыть добавление).
 *  Удержание ~0.45с включает режим перетаскивания (кнопка приподнимается) —
 *  дальше тащишь её в любое удобное место. Так согласуется с переносом задач и
 *  проектов (тоже удержанием) и исключает случайный сдвиг при обычном нажатии.
 *  Позиция хранится в settings (device-local) — у каждого человека своя.
 *  Во время переноса двигаем через transform (без reflow) — движение плавное.
 *  Кнопка поднимается выше мини-помодоро в ЛЮБОЙ позиции, включая
 *  перенесённую руками: раньше подъём жил только в bottom-классе дефолта.
 *  При прокрутке вниз кнопка уезжает с экрана и возвращается при прокрутке
 *  вверх (поведение Material). Причина: стоя в одной точке, она перекрывала
 *  то, что под неё попадало — карандаш «Изменить раздел» на «Сегодня»
 *  (перекрытие 84-87%, тап открывал «Новая задача»), сегмент «Год» в Финансах
 *  (49%). Само по себе прятание помогает лишь наполовину: возвращаясь при
 *  прокрутке вверх, кнопка встаёт на то же место. Вторую половину закрыл
 *  переезд install-баннера в ленту — без него кнопка стоит в углу, а не в
 *  середине экрана. */
export function Fab({ onClick, label }: Props) {
  const { active } = usePomodoro();
  const settings = useSettings();
  const saved = settings.fabPosition ?? null;
  const direction = useScrollDirection();

  const [dragging, setDragging] = useState(false);
  // Позиция, применённая сразу после переноса — чтобы кнопка не мигнула в момент
  // между отпусканием и синком с settings. null — берём из settings (или дефолт).
  const [override, setOverride] = useState<{ x: number; y: number } | null>(null);

  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const g = useRef({
    armed: false, // палец опущен, ждём удержание
    dragMode: false, // удержание сработало — тащим
    moved: false, // было реальное перемещение
    wasDrag: false, // подавить click после режима перетаскивания
    sx: 0,
    sy: 0,
    baseX: 0,
    baseY: 0,
    curX: 0,
    curY: 0,
    pointerId: 0,
  });

  // Пока кнопка на экране — контент внизу страницы держит под неё отступ (его
  // читают Screen и EmptyState). Layout-эффект, а не обычный: отступ появляется
  // до отрисовки кадра, иначе на переходе виден скачок контента.
  useLayoutEffect(() => {
    mounted += 1;
    document.documentElement.style.setProperty('--fab-space', FAB_SPACE);
    return () => {
      mounted -= 1;
      if (mounted === 0) document.documentElement.style.setProperty('--fab-space', '0px');
    };
  }, []);

  // Клиренс снизу: таб-бар с safe-area + полоска мини-помодоро, когда он идёт.
  // Install-баннера здесь больше нет: он переехал в ленту (App.tsx) и уезжает
  // с прокруткой. Пока он стоял отдельным блоком над таб-баром, кнопка
  // поднималась на его высоту (до 150px) и садилась в середину экрана, где
  // перекрывала живые элементы — сегмент «Год» в Финансах на 66%, карандаш
  // раздела на 93%.
  const clearance = `calc(env(safe-area-inset-bottom) + ${active ? 128 : 80}px)`;

  // Куда рисуем: только что перенесли (override) → сохранённая → дефолт
  // (right/bottom). Границы для своей позиции считает CSS через clamp(), а не JS:
  // так подъём над баннером/таймером пересчитывается сам при их появлении и при
  // повороте экрана — без ре-рендера, которого кнопке взять неоткуда (высоту
  // баннера ей никто не сообщает). Во время переноса left/top остаются базой,
  // а смещение идёт через transform.
  const pos = override ?? saved;

  // Во время переноса не прячем ни при каком направлении: палец на кнопке, а
  // ленту в этот момент может прокрутить вторая рука.
  const hidden = direction === 'down' && !dragging;

  // Уехавшая кнопка не должна остаться в фокусе: на ней aria-hidden, и фокус
  // на скрытом от скринридера элементе — это ловушка для клавиатуры.
  useEffect(() => {
    if (hidden && document.activeElement === ref.current) ref.current?.blur();
  }, [hidden]);

  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const releaseCapture = () => {
    try {
      ref.current?.releasePointerCapture(g.current.pointerId);
    } catch {
      /* указатель уже отпущен */
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    g.current = {
      armed: true,
      dragMode: false,
      moved: false,
      wasDrag: false,
      sx: e.clientX,
      sy: e.clientY,
      baseX: r.left,
      baseY: r.top,
      curX: r.left,
      curY: r.top,
      pointerId: e.pointerId,
    };
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже неактивен */
    }
    clearTimer();
    timer.current = setTimeout(() => {
      if (!g.current.armed) return;
      g.current.dragMode = true;
      g.current.wasDrag = true;
      try {
        navigator.vibrate?.(10); // тактильный сигнал «взял» (где поддерживается)
      } catch {
        /* без вибрации */
      }
      setDragging(true);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = g.current;
    if (!s.armed) return;
    if (!s.dragMode) {
      // Ждём удержание. Заметный сдвиг раньше времени = не перетаскивание: отменяем
      // (и глушим последующий click, чтобы свайп по кнопке не добавил задачу).
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > CANCEL_MOVE) {
        clearTimer();
        s.armed = false;
        s.wasDrag = true;
        releaseCapture();
      }
      return;
    }
    const reserve = active ? TIMER_SPACE : 0;
    const clamped = clampToViewport(
      s.baseX + (e.clientX - s.sx),
      s.baseY + (e.clientY - s.sy),
      reserve,
    );
    s.curX = clamped.x;
    s.curY = clamped.y;
    s.moved = true;
    // Императивно, без ре-рендера: transform не вызывает reflow — движение плавное.
    if (ref.current) {
      ref.current.style.transform = `translate(${clamped.x - s.baseX}px, ${clamped.y - s.baseY}px)`;
    }
  };

  const onPointerUp = () => {
    const s = g.current;
    clearTimer();
    releaseCapture();
    if (s.dragMode) {
      if (ref.current) ref.current.style.transform = '';
      if (s.moved) {
        const final = { x: s.curX, y: s.curY };
        setOverride(final);
        void updateSettings({ fabPosition: final });
      }
      setDragging(false);
    }
    s.armed = false;
    s.dragMode = false;
  };

  const handleClick = () => {
    if (g.current.wasDrag) {
      g.current.wasDrag = false;
      return; // был режим перетаскивания / отменённый свайп — не нажатие
    }
    onClick();
  };

  return (
    <button
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={handleClick}
      aria-label={label ?? t('Добавить')}
      // Спрятанная кнопка полностью выключена: pointer-events-none снимает
      // перехват тапов (одного увода вниз мало — своя позиция может быть где
      // угодно, и кнопка осталась бы под пальцем), tabIndex убирает её из
      // обхода клавиатурой, aria-hidden — из дерева доступности.
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      style={{
        backgroundImage: 'linear-gradient(140deg, var(--app-accent-fill), var(--app-accent-2-fill))',
        touchAction: 'none', // касание кнопки не скроллит страницу — тащим её саму
        // Свойство translate, а не transform: transform занят переносом
        // (императивно в onPointerMove), и они бы затирали друг друга.
        // Сдвиг = размер кнопки + её клиренс: из дефолтной позиции это ровно
        // за нижний край экрана. '0 0' вместо отсутствия значения — чтобы
        // браузеру было что интерполировать в обратную сторону.
        translate: hidden ? `0 calc(${FAB_SIZE}px + ${clearance})` : '0 0',
        ...(pos
          ? {
              left: `clamp(${EDGE}px, ${pos.x}px, calc(100vw - ${FAB_SIZE + EDGE}px))`,
              top: `clamp(${TOP_GAP}px, ${pos.y}px, calc(100dvh - ${FAB_SIZE}px - ${clearance}))`,
            }
          : // Дефолт: у правого края центральной колонки (max-w-lg = 32rem).
            { right: 'max(1.25rem, calc(50vw - 16rem))', bottom: clearance }),
        ...(dragging ? { willChange: 'transform' } : {}),
      }}
      // select-none + webkit-touch-callout/user-select/tap-highlight — глушим
      // нативную iOS-реакцию на удержание (лупа, синее выделение, callout),
      // иначе она перебивает наш жест переноса. Позиция задана в style (right/
      // bottom для дефолта, left/top для своей) — в ней CSS-функции с env() и
      // переменными, Tailwind-классы такое не покрывают. Плавность (transition)
      // выключаем на время переноса, иначе она «догоняет» transform и кнопка
      // дёргается; top в списке — своя позиция тоже уезжает вверх при появлении
      // баннера или таймера. active:scale-90 — только вне переноса (в переносе
      // кнопка приподнята scale-105). opacity-0 в паре с уводом вниз: из своей
      // позиции (левый/верхний край) сдвига может не хватить до края экрана, и
      // без прозрачности осталась бы видимая кнопка, не реагирующая на тап.
      // motion-reduce:transition-none — при «уменьшить движение» кнопка просто
      // переключается, без проезда.
      className={`fixed z-40 flex size-14 select-none items-center justify-center rounded-full text-white shadow-[var(--shadow-accent)] [-webkit-touch-callout:none] [-webkit-user-select:none] [-webkit-tap-highlight-color:transparent] ${
        dragging ? 'scale-105 shadow-2xl' : 'active:scale-90'
      } ${hidden ? 'pointer-events-none opacity-0' : ''} ${
        dragging ? '' : 'transition-[translate,opacity,transform,bottom,top] duration-200 motion-reduce:transition-none'
      }`}
    >
      <Plus size={ICON.accent} strokeWidth={STROKE_HEAVY} className="pointer-events-none" />
    </button>
  );
}
