import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { todayKey } from '../../lib/dates';
import { t } from '../../lib/i18n';
import { ENERGY_LABEL, ENERGY_LEVELS, levelByDate } from '../../lib/energy';
import { useNavLayout } from '../../hooks/useNavLayout';
import { toggleEnergyLevel } from './energyRepo';
import type { EnergyLevel } from '../../db/types';

/** Шкала 1–5 одной строкой: отметка ставится одним тапом прямо с «Сегодня».
 *  Ежедневный ритуал выживает, только если он в один жест — переход в раздел
 *  ради отметки его бы убил.
 *
 *  Поэтому пока отметки НЕТ, шкала всегда здесь, во всю ширину. Как только
 *  она поставлена, строка сворачивается: значение переезжает в ячейку полосы
 *  дня, а 113px возвращаются задачам. `open` — это раскрытие обратно по тапу
 *  на ту ячейку: изменить отметку можно в любой момент, и снова одним тапом. */
export function EnergyTodayLine({ open = false }: { open?: boolean }) {
  const { hidden } = useNavLayout();
  const today = todayKey();
  const logs = useLiveQuery(() => db.energyLogs.toArray(), []);
  const current = levelByDate(alive(logs ?? [])).get(today) ?? null;

  // После хуков, не раньше: порядок хуков в React не может зависеть от условия.
  // Скрытый раздел молчит — выключивший «Энергию» не должен видеть ни строку
  // ввода, ни намёков на неё (то же правило, что у привычек в HabitsToday).
  if (hidden.includes('energy')) return null;
  // Отмеченный день показывает полоса — здесь дублировать нечего.
  if (current != null && !open) return null;

  return (
    <section className="mb-5">
      <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-muted">
        <span>{t('Энергия')}</span>
        <span className="text-xs font-normal">
          {current ? t(ENERGY_LABEL[current]) : t('не отмечено')}
        </span>
      </h2>
      <div className="card flex items-center gap-1 px-2 py-2">
        {ENERGY_LEVELS.map((n) => {
          const active = current === n;
          return (
            <button
              key={n}
              type="button"
              aria-label={`${n} — ${t(ENERGY_LABEL[n])}`}
              aria-pressed={active}
              onClick={() => void toggleEnergyLevel(today, n as EnergyLevel, current)}
              className="flex h-11 flex-1 items-center justify-center active:opacity-70"
            >
              <span
                className={`flex size-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-accent-fill text-white shadow-[0_2px_10px_-3px_var(--app-accent-fill)]'
                    : 'bg-surface-2 text-muted'
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>
      {/* Якоря показываются, пока отметки нет: шкала должна мерить способность
          работать, а не настроение, иначе значения плывут от недели к неделе.
          После отметки подпись уровня уже стоит в заголовке — дубль убираем. */}
      {!current && (
        <p className="mt-1.5 px-1 text-2xs text-muted">
          {t('1 — еле держусь · 3 — рабочий режим · 5 — прёт')}
        </p>
      )}
    </section>
  );
}
