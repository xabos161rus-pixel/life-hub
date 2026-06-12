import { useEffect, useState } from 'react';

/**
 * Статус хранилища: защищено ли оно от вытеснения (persisted)
 * и сколько занято (МБ, 1 знак). null — неизвестно / API не поддерживается.
 */
export function usePersistentStorage(): {
  persisted: boolean | null;
  usageMb: number | null;
} {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usageMb, setUsageMb] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.storage
      ?.persisted?.()
      .then((p) => {
        if (!cancelled) setPersisted(p);
      })
      .catch(() => {});
    navigator.storage
      ?.estimate?.()
      .then((est) => {
        if (!cancelled && typeof est.usage === 'number') {
          setUsageMb(Math.round((est.usage / (1024 * 1024)) * 10) / 10);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return { persisted, usageMb };
}
