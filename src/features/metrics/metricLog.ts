import { db } from '../../db/db';
import { alive, create, update } from '../../db/repo';
import { todayKey } from '../../lib/dates';
import type { MetricLog } from '../../db/types';

/**
 * Одна точка истории метрики на дату: обновляет лог за сегодня, если он есть,
 * иначе создаёт новый. Без этого кнопки +/− и сохранение из шита плодили
 * несколько точек за один день и искажали спарклайн.
 */
export async function upsertMetricLog(metricId: string, value: number): Promise<void> {
  const date = todayKey();
  const existing = alive<MetricLog>(
    await db.metricLogs.where('metricId').equals(metricId).toArray(),
  ).find((l) => l.date === date);
  if (existing) await update(db.metricLogs, existing.id, { value });
  else await create(db.metricLogs, { metricId, date, value });
}
