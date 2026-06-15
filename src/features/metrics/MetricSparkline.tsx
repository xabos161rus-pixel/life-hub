import type { MetricLog } from '../../db/types';

const WIDTH = 100; // viewBox-единицы; растягивается на 100% ширины контейнера
const HEIGHT = 36;
const PAD = 3; // вертикальный отступ, чтобы линия не упиралась в края

/** Спарклайн динамики метрики: polyline по логам, нормированный по min/max. */
export function MetricSparkline({ logs }: { logs: MetricLog[] }) {
  if (logs.length < 2) return null;

  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map((l) => l.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // защита от деления на ноль (плоская линия)

  const points = sorted
    .map((log, i) => {
      const x = sorted.length === 1 ? 0 : (i / (sorted.length - 1)) * WIDTH;
      const y = HEIGHT - PAD - ((log.value - min) / span) * (HEIGHT - PAD * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-9 w-full text-accent"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
