// Когда делать облачную копию.
//
// Решение вынесено из планировщика отдельно, чтобы его можно было проверить:
// внутри компонента оно проверялось только вручную, а ошибиться тут дорого.
// Копия падает по причинам, которые сами собой не исчезают (нет сети, кончилось
// место, слишком большой снапшот), и повтор каждые пять минут — это полный
// экспорт базы плюс скачивание прошлой копии, то есть батарея и трафик впустую.

const DAY = 24 * 60 * 60_000;
const WEEK = 7 * DAY;
/** Пауза после неудачи. */
export const RETRY_AFTER_FAIL_MS = 60 * 60_000;

export interface BackupState {
  autoBackup?: string | null;
  autoBackupEvery?: string | null;
  lastCloudBackupAt?: string | null;
  cloudBackupFailedAt?: string | null;
}

export function shouldBackupNow(s: BackupState | undefined, nowMs: number): boolean {
  if (!s || s.autoBackup !== 'cloud') return false;
  const interval = s.autoBackupEvery === 'weekly' ? WEEK : DAY;
  const last = s.lastCloudBackupAt ? new Date(s.lastCloudBackupAt).getTime() : 0;
  if (nowMs - last < interval) return false;
  const failed = s.cloudBackupFailedAt ? new Date(s.cloudBackupFailedAt).getTime() : 0;
  if (nowMs - failed < RETRY_AFTER_FAIL_MS) return false;
  return true;
}
