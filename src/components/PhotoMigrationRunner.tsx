import { useEffect } from 'react';
import { migrateTaskPhotos } from '../lib/taskPhotos';

/** Фоновое перекладывание фотографий задач в свою таблицу.
 *
 *  Работает порциями и только когда приложение на экране: на телефоне это
 *  чужая работа в чужое время, и занимать ею поток, пока человек листает
 *  список, незачем. Перекладывание идемпотентно и не трогает строки задач,
 *  поэтому прерваться на любом месте безопасно — следующий заход доделает.
 */
export function PhotoMigrationRunner() {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const step = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      let moved = 0;
      try {
        moved = await migrateTaskPhotos(5);
      } catch {
        /* база занята или места нет — попробуем в следующий раз */
      }
      if (stopped) return;
      // Пока есть что перекладывать — продолжаем с паузой, чтобы не занимать
      // поток. Когда закончилось, замолкаем до следующего появления на экране.
      if (moved > 0) timer = setTimeout(() => void step(), 400);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void step();
    };
    void step();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return null;
}
