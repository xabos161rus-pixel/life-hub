import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Pause, Play, RotateCcw } from 'lucide-react';
import {
  GClose as X,
} from '../../components/ui/glyphs';
import { formatClock, usePomodoro } from './pomodoro';
import { t } from '../../lib/i18n';

/** Полоска-таймер над таб-баром, пока идёт помодоро. Тап — открыть «Фокус». */
export function MiniTimer() {
  const p = usePomodoro();
  const nav = useNavigate();
  const { pathname } = useLocation();

  // «Убрать с раздела» — локально прячем плашку. Новый круг (смена фазы) или
  // (де)активация таймера возвращают её. Сбрасываем во время рендера (паттерн
  // React «скорректировать состояние при изменении входа»), не в эффекте.
  const [dismissed, setDismissed] = useState(false);
  const [marker, setMarker] = useState({ phase: p.phase, active: p.active });
  if (marker.phase !== p.phase || marker.active !== p.active) {
    setMarker({ phase: p.phase, active: p.active });
    setDismissed(false);
  }

  if (!p.active) return null;
  if (dismissed) return null;
  if (pathname === '/more/focus') return null; // на самой странице не дублируем
  if (/^\/notes\/.+/.test(pathname)) return null; // там таб-бара нет

  const color = p.phase === 'work' ? 'var(--focus-accent)' : 'var(--app-success)';
  // Бокс 36px вместо прежних 26: три кнопки идут подряд через gap-2, и
  // невидимая зона 44 им не подходит — соседние зоны перекрылись бы (ограничение
  // в hitSlop.ts: не ближе 11px друг к другу). Поэтому растёт сама кнопка:
  // 36 + 8 зазора = шаг 44, попадание пальцем без промаха по соседу.
  const iconBtn = 'flex size-9 shrink-0 items-center justify-center rounded-full text-muted active:opacity-60';
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('Открыть Фокус')}
      onClick={() => nav('/more/focus')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          nav('/more/focus');
        }
      }}
      className="z-30 flex shrink-0 cursor-pointer items-center gap-2 border-t border-hairline bg-elevated px-4 py-2 active:opacity-80"
    >
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color }}>
        {formatClock(p.remainingMs)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted">
        {p.phase === 'work' ? p.taskTitle || t('Фокус') : t('Перерыв')}
      </span>
      <button
        type="button"
        aria-label={p.running ? t('Пауза') : t('Продолжить')}
        onClick={(e) => {
          e.stopPropagation();
          p.toggle();
        }}
        className={iconBtn}
      >
        {p.running ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <button
        type="button"
        aria-label={t('Сбросить помодоро')}
        onClick={(e) => {
          e.stopPropagation();
          p.reset();
        }}
        className={iconBtn}
      >
        <RotateCcw size={18} />
      </button>
      <button
        type="button"
        aria-label={t('Убрать таймер')}
        onClick={(e) => {
          e.stopPropagation();
          setDismissed(true);
        }}
        className={iconBtn}
      >
        <X size={18} />
      </button>
    </div>
  );
}
