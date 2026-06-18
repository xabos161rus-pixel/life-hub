import { useEffect } from 'react';
import { runSync } from '../lib/sync';

const INTERVAL_MS = 60_000;

/** Запускает синхронизацию при старте, возврате в приложение и периодически.
 *  runSync сам выходит, если синк не настроен/выключен (или уже идёт). */
export function SyncRunner() {
  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') void runSync().catch(() => {});
    };
    sync(); // при запуске
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    const id = setInterval(sync, INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      clearInterval(id);
    };
  }, []);
  return null;
}
