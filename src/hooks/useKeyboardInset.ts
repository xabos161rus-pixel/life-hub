import { useEffect, useState } from 'react';

/** Сколько пикселей снизу съедает экранная клавиатура прямо сейчас. 0 — закрыта.
 *
 *  Считается по visualViewport: layout-вьюпорт (innerHeight) минус видимая
 *  область. Слушаем и resize, и scroll — iOS двигает offsetTop при прокрутке
 *  сжатого вьюпорта, и без второй подписки значение отстаёт от реальности.
 *  Элементы с fixed bottom-0 клавиатура на iOS просто накрывает (fixed живёт
 *  в layout-вьюпорте) — потребители поднимают их translateY(-inset) и на ту же
 *  величину увеличивают нижний отступ контента. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Мелкие колебания (адресная строка, safe-area) — не клавиатура: не
      // дёргаем layout из-за пары пикселей.
      setInset(covered > 40 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
