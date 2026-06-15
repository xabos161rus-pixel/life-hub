import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Gauge, Minus, Plus } from 'lucide-react';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { db } from '../../db/db';
import { alive, create, update } from '../../db/repo';
import { todayKey } from '../../lib/dates';
import type { Metric, MetricLog } from '../../db/types';
import { MetricSheet } from './MetricSheet';
import { MetricSparkline } from './MetricSparkline';

const STEP_BTN_CLASS =
  'flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text active:opacity-70';

/** Короткое представление числа: целое без дробной части, иначе один знак. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function MetricCard({ metric, onOpen }: { metric: Metric; onOpen: () => void }) {
  const logRows = useLiveQuery(
    () => db.metricLogs.where('metricId').equals(metric.id).toArray(),
    [metric.id],
  );
  const logs = alive<MetricLog>(logRows ?? []);

  const isPercent = metric.unit === '%';
  const step = isPercent ? 5 : 1;

  const setValue = async (next: number) => {
    const value = Math.max(0, next);
    if (value === metric.currentValue) return;
    await update(db.metrics, metric.id, { currentValue: value });
    await create(db.metricLogs, { metricId: metric.id, date: todayKey(), value });
  };

  const ringLabel = `${fmt(metric.currentValue)}${isPercent ? '%' : ''}`;
  const ringValue =
    metric.targetValue && metric.targetValue > 0
      ? Math.max(0, Math.min(100, (metric.currentValue / metric.targetValue) * 100))
      : 0;

  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <div className="flex items-center gap-3">
        {metric.targetValue != null ? (
          <ProgressRing value={ringValue} color={metric.color} label={ringLabel} />
        ) : (
          <div
            className="flex min-w-14 shrink-0 items-center justify-center text-2xl font-bold tabular-nums"
            style={{ color: metric.color }}
          >
            {fmt(metric.currentValue)}
          </div>
        )}
        <button onClick={onOpen} className="min-w-0 flex-1 text-left active:opacity-70">
          <p className="truncate font-semibold">{metric.title}</p>
          <p className="truncate text-sm text-muted">
            {`Текущее: ${fmt(metric.currentValue)}${metric.unit ? ` ${metric.unit}` : ''}`}
            {metric.targetValue != null &&
              ` · Цель: ${fmt(metric.targetValue)}${metric.unit ? ` ${metric.unit}` : ''}`}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className={STEP_BTN_CLASS}
            aria-label="Уменьшить"
            disabled={metric.currentValue <= 0}
            onClick={() => void setValue(metric.currentValue - step)}
          >
            <Minus size={18} />
          </button>
          <button
            className={STEP_BTN_CLASS}
            aria-label="Увеличить"
            onClick={() => void setValue(metric.currentValue + step)}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
      {logs.length >= 2 && (
        <div className="mt-3">
          <MetricSparkline logs={logs} />
        </div>
      )}
    </div>
  );
}

export function MetricsPage() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Metric | null>(null);

  const rows = useLiveQuery(() => db.metrics.toArray(), []);
  const metrics = alive<Metric>(rows ?? []).sort((a, b) => a.sortOrder - b.sortOrder);

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (metric: Metric) => {
    setEditing(metric);
    setSheetOpen(true);
  };

  return (
    <Screen title="Метрики" backTo="/more">
      <div className="space-y-3">
        {metrics.length === 0 ? (
          <EmptyState
            icon={Gauge}
            title="Пока нет метрик"
            hint="Добавьте показатель, который хотите отслеживать: вес, % владения языком, километраж."
          />
        ) : (
          metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} onOpen={() => openEdit(metric)} />
          ))
        )}
      </div>
      <Fab onClick={openCreate} />
      <MetricSheet open={sheetOpen} onClose={() => setSheetOpen(false)} metric={editing} />
    </Screen>
  );
}
