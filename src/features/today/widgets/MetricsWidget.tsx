import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { db } from '../../../db/db';
import { alive } from '../../../db/repo';
import { ProgressBar } from '../../../components/ui/ProgressBar';

/** «Метрики» — до 3 показателей мини-строками: title + прогресс или значение. */
export function MetricsWidget() {
  const metricsRaw = alive(useLiveQuery(() => db.metrics.toArray(), []) ?? []);

  const metrics = useMemo(
    () => [...metricsRaw].sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 3),
    [metricsRaw],
  );

  if (metrics.length === 0) return null;

  return (
    <section className="mb-5">
      <Link
        to="/more/metrics"
        className="mb-2 block text-sm font-semibold text-muted active:opacity-60"
      >
        Метрики
      </Link>
      <div className="card space-y-3 px-4 py-3.5">
        {metrics.map((m) => {
          const pct =
            m.targetValue && m.targetValue > 0
              ? Math.max(0, Math.min(100, (100 * m.currentValue) / m.targetValue))
              : null;
          return (
            <div key={m.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-text">{m.title}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {m.currentValue}
                  {pct !== null ? ` / ${m.targetValue}` : ''} {m.unit}
                </span>
              </div>
              {pct !== null && (
                <div className="mt-1">
                  <ProgressBar value={pct} color={m.color} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
