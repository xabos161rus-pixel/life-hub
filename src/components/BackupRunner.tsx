import { useEffect } from 'react';
import { db } from '../db/db';
import { now } from '../db/repo';
import { updateSettings } from '../hooks/useSettings';
import { getSyncConfig } from '../lib/syncState';
import { BackupWouldLoseDataError, pushAccountSnapshot } from '../lib/cloudBackup';

const CHECK_MS = 5 * 60_000; // сверяемся раз в 5 минут (пока приложение открыто)
const DAY = 24 * 60 * 60_000;
const WEEK = 7 * DAY;

// Курсор времени в модуле: не спамим БД проверками между тиками одной сессии.
let inFlight = false;

async function maybeBackup(): Promise<void> {
  if (inFlight) return;
  const s = await db.settings.get('app');
  if (!s || s.autoBackup !== 'cloud') return;
  const c = await getSyncConfig();
  if (!c?.enabled) return; // облачная копия — только при включённой синхронизации
  const interval = s.autoBackupEvery === 'weekly' ? WEEK : DAY;
  const last = s.lastCloudBackupAt ? new Date(s.lastCloudBackupAt).getTime() : 0;
  if (Date.now() - last < interval) return;
  inFlight = true;
  try {
    await pushAccountSnapshot();
    await updateSettings({ lastCloudBackupAt: now(), cloudBackupBlocked: null });
  } catch (e) {
    // Автокопия НИКОГДА не перезаписывает копию, которая полнее нашей: у
    // фонового процесса нет способа спросить, а молча стереть чужую историю
    // цикла и переписку он не вправе. Оставляем след, чтобы настройки могли
    // показать это человеку — иначе автокопия просто «не работает» без
    // объяснений.
    if (e instanceof BackupWouldLoseDataError) {
      await updateSettings({ cloudBackupBlocked: now() });
    } else {
      throw e;
    }
  } finally {
    inFlight = false;
  }
}

/** Периодически кладёт зашифрованный снапшот аккаунта в облако, если включена
 *  авто-копия. Тихо выходит, когда выключено или синхронизация не настроена. */
export function BackupRunner() {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void maybeBackup().catch(() => {});
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    const id = setInterval(tick, CHECK_MS);
    return () => {
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
      clearInterval(id);
    };
  }, []);
  return null;
}
