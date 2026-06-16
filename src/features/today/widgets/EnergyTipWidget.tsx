import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { BatteryCharging } from 'lucide-react';
import { db } from '../../../db/db';
import { alive } from '../../../db/repo';
import type { EnergyItem } from '../../../db/types';
import { todayKey } from '../../../lib/dates';

/** Сумма цифр в ключе даты — детерминированный сид на день. */
function digitSum(key: string): number {
  let sum = 0;
  for (const ch of key) {
    if (ch >= '0' && ch <= '9') sum += ch.charCodeAt(0) - 48;
  }
  return sum;
}

/**
 * «Заряд энергии» — один совет на день для сценария «нет сил».
 * Предпочитаем низкозатратные (effort==='low'); если таких нет — любой.
 * Выбор стабилен в течение дня: индекс из суммы цифр сегодняшней даты.
 */
export function EnergyTipWidget() {
  const items = alive(useLiveQuery(() => db.energyItems.toArray(), []) ?? []);

  const tip = useMemo<EnergyItem | null>(() => {
    if (items.length === 0) return null;
    const lowEffort = items.filter((i) => i.effort === 'low');
    const pool = lowEffort.length > 0 ? lowEffort : items;
    const ordered = [...pool].sort((a, b) => a.sortOrder - b.sortOrder);
    return ordered[digitSum(todayKey()) % ordered.length];
  }, [items]);

  if (!tip) return null;

  return (
    <section className="mb-5">
      <Link
        to="/more/energy"
        className="mb-2 block text-sm font-semibold text-muted active:opacity-60"
      >
        Заряд энергии
      </Link>
      <Link to="/more/energy" className="card block px-4 py-3.5 active:opacity-80">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-accent">
            <BatteryCharging size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Когда нет сил: {tip.title}</p>
            {tip.description && (
              <p className="mt-1 text-sm text-muted">{tip.description}</p>
            )}
          </div>
        </div>
      </Link>
    </section>
  );
}
