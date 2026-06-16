import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Gauge, Minus, Plus } from 'lucide-react';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { db } from '../../db/db';
import { alive, update } from '../../db/repo';
import type { Metric, MetricLog } from '../../db/types';
import { computeAutoMetrics } from '../../lib/autoMetrics';
import { formatRub } from '../../lib/finance';
import { MetricSheet } from './MetricSheet';
import { MetricSparkline } from './MetricSparkline';
import { upsertMetricLog } from './metricLog';

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
    await upsertMetricLog(metric.id, value);
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

function SummaryCell({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

/** Авто-сводка по всему приложению. Скрывается, если данных нет совсем. */
function SummaryWidget() {
  const auto = useLiveQuery(() => computeAutoMetrics(), []);
  if (!auto || auto.coverage === 0) return null;

  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-muted">Сводка</h2>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <SummaryCell value={String(auto.tasksDone7)} label="Выполнено за 7 дней" />
        <SummaryCell value={String(auto.tasksAdded7)} label="Добавлено за 7 дней" />
        <SummaryCell
          value={auto.onTimeRate === null ? '—' : `${auto.onTimeRate}%`}
          label="В срок (работоспособность)"
        />
        <SummaryCell value={`${auto.openTasks} / ${auto.overdueTasks}`} label="Открыто / Просрочено" />
        <div className="flex items-center gap-3">
          <ProgressRing value={auto.goalsAvgProgress} />
          <div>
            <p className="text-sm font-semibold">{auto.goalsActive}</p>
            <p className="text-xs text-muted">Активных целей</p>
          </div>
        </div>
        <SummaryCell
          value={auto.learningProgress === null ? '—' : `${auto.learningProgress}%`}
          label="Прогресс обучения"
        />
        <SummaryCell value={String(auto.booksRead)} label="Прочитано книг" />
        <SummaryCell value={`${auto.coverage}/8`} label="Охват жизни" />
        <SummaryCell value={formatRub(auto.financeBalance)} label="Баланс в месяц" />
      </div>
    </section>
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
      <div className="space-y-4">
        <SummaryWidget />
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted">Мои метрики</h2>
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
      </div>
      <Fab onClick={openCreate} />
      <MetricSheet open={sheetOpen} onClose={() => setSheetOpen(false)} metric={editing} />
    </Screen>
  );
}
