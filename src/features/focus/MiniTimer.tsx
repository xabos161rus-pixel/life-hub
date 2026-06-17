import { useLocation, useNavigate } from 'react-router';
import { Pause, Play } from 'lucide-react';
import { formatClock, usePomodoro } from './PomodoroProvider';

/** Полоска-таймер над таб-баром, пока идёт помодоро. Тап — открыть «Фокус». */
export function MiniTimer() {
  const p = usePomodoro();
  const nav = useNavigate();
  const { pathname } = useLocation();
  if (!p.active) return null;
  if (pathname === '/more/focus') return null; // на самой странице не дублируем
  if (/^\/notes\/.+/.test(pathname)) return null; // там таб-бара нет
  const color = p.phase === 'work' ? 'var(--focus-accent)' : 'var(--app-success)';
  return (
    <div
      role="button"
      onClick={() => nav('/more/focus')}
      className="z-30 flex shrink-0 cursor-pointer items-center gap-3 border-t border-hairline bg-elevated px-4 py-2 active:opacity-80"
    >
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color }}>
        {formatClock(p.remainingMs)}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted">
        {p.phase === 'work' ? p.taskTitle || 'Фокус' : 'Перерыв'}
      </span>
      <button
        type="button"
        aria-label={p.running ? 'Пауза' : 'Продолжить'}
        onClick={(e) => {
          e.stopPropagation();
          p.toggle();
        }}
        className="shrink-0 p-1 text-muted active:opacity-60"
      >
        {p.running ? <Pause size={18} /> : <Play size={18} />}
      </button>
    </div>
  );
}
