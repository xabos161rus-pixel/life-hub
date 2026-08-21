// Когда автокопия делается, а когда нет.

import { describe, expect, it } from 'vitest';
import { RETRY_AFTER_FAIL_MS, shouldBackupNow } from './backupSchedule';

const NOW = new Date('2026-08-22T12:00:00.000Z').getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe('расписание облачной копии', () => {
  it('выключенная автокопия не делается никогда', () => {
    expect(shouldBackupNow({ autoBackup: 'off', lastCloudBackupAt: iso(30 * DAY) }, NOW)).toBe(false);
    expect(shouldBackupNow(undefined, NOW)).toBe(false);
  });

  it('первая копия делается сразу', () => {
    expect(shouldBackupNow({ autoBackup: 'cloud' }, NOW)).toBe(true);
  });

  it('свежая копия не повторяется до срока', () => {
    expect(shouldBackupNow({ autoBackup: 'cloud', lastCloudBackupAt: iso(2 * HOUR) }, NOW)).toBe(false);
    expect(shouldBackupNow({ autoBackup: 'cloud', lastCloudBackupAt: iso(DAY + HOUR) }, NOW)).toBe(true);
  });

  it('еженедельный режим ждёт неделю, а не сутки', () => {
    const s = { autoBackup: 'cloud', autoBackupEvery: 'weekly', lastCloudBackupAt: iso(2 * DAY) };
    expect(shouldBackupNow(s, NOW)).toBe(false);
    expect(shouldBackupNow({ ...s, lastCloudBackupAt: iso(8 * DAY) }, NOW)).toBe(true);
  });

  it('после неудачи выдерживается пауза — иначе попытка каждые пять минут', () => {
    // Каждая попытка — полный экспорт базы плюс скачивание прошлой копии.
    // Повтор через пять минут (да ещё на каждый возврат в приложение) съедал
    // батарею и трафик молча, а причина сбоя за это время не менялась.
    const failedJustNow = { autoBackup: 'cloud', cloudBackupFailedAt: iso(5 * 60_000) };
    expect(shouldBackupNow(failedJustNow, NOW)).toBe(false);

    const failedLongAgo = { autoBackup: 'cloud', cloudBackupFailedAt: iso(RETRY_AFTER_FAIL_MS + 60_000) };
    expect(shouldBackupNow(failedLongAgo, NOW)).toBe(true);
  });

  it('пауза после неудачи не отменяет обычный интервал', () => {
    // Неудача была давно, но и копия свежая — ждём срока.
    expect(
      shouldBackupNow(
        { autoBackup: 'cloud', lastCloudBackupAt: iso(HOUR), cloudBackupFailedAt: iso(5 * DAY) },
        NOW,
      ),
    ).toBe(false);
  });
});
