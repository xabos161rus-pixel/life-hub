import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { Screen } from '../../components/layout/Screen';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { formatClock, usePomodoro, type Phase } from './PomodoroProvider';

const PHASE_LABEL: Record<Phase, string> = {
  work: 'Фокус',
  break: 'Перерыв',
  long: 'Длинный перерыв',
};

const PRESETS: { work: number; break: number; label: string }[] = [
  { work: 25, break: 5, label: '25 / 5' },
  { work: 50, break: 10, label: '50 / 10' },
  { work: 90, break: 20, label: '90 / 20' },
];

const R = 130;
const STROKE = 12;
const CIRC = 2 * Math.PI * R;

export function FocusPage() {
  const p = usePomodoro();
  const progress = p.totalMs > 0 ? 1 - p.remainingMs / p.totalMs : 0;
  const ringColor = p.phase === 'work' ? 'var(--app-accent)' : 'var(--app-success)';

  return (
    <Screen title="Фокус" backTo="/more">
      <div className="flex flex-col items-center">
        <p
          className="mb-4 text-sm font-semibold"
          style={{ color: ringColor }}
        >
          {PHASE_LABEL[p.phase]}
        </p>

        <div className="relative">
          <svg viewBox="0 0 300 300" className="w-64 max-w-[72vw]">
            <circle
              cx="150"
              cy="150"
              r={R}
              fill="none"
              stroke="var(--app-hairline)"
              strokeWidth={STROKE}
            />
            <circle
              cx="150"
              cy="150"
              r={R}
              fill="none"
              stroke={ringColor}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              transform="rotate(-90 150 150)"
              style={{ transition: 'stroke-dashoffset 0.5s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-bold tabular-nums tracking-tight">
              {formatClock(p.remainingMs)}
            </span>
            {p.taskTitle && (
              <span className="mt-1 max-w-[60%] truncate text-sm text-muted">{p.taskTitle}</span>
            )}
          </div>
        </div>

        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={p.reset}
            aria-label="Сбросить"
            className="flex size-12 items-center justify-center rounded-full border border-border text-muted active:scale-90"
          >
            <RotateCcw size={20} />
          </button>
          <button
            onClick={p.running ? p.toggle : () => (p.active ? p.toggle() : p.start())}
            aria-label={p.running ? 'Пауза' : 'Старт'}
            className="flex size-20 items-center justify-center rounded-full bg-accent text-white shadow-[var(--shadow-accent)] active:scale-90"
          >
            {p.running ? <Pause size={32} fill="#fff" /> : <Play size={32} fill="#fff" className="ml-1" />}
          </button>
          <button
            onClick={p.skip}
            aria-label="Пропустить фазу"
            className="flex size-12 items-center justify-center rounded-full border border-border text-muted active:scale-90"
          >
            <SkipForward size={20} />
          </button>
        </div>

        <div className="mt-8 w-full">
          <p className="mb-2 px-1 text-sm font-medium text-muted">Длительность (мин)</p>
          <ChipRow>
            {PRESETS.map((pr) => (
              <Chip
                key={pr.label}
                active={p.workMin === pr.work && p.breakMin === pr.break}
                onClick={() => p.setDurations(pr.work, pr.break)}
              >
                {pr.label}
              </Chip>
            ))}
          </ChipRow>
        </div>

        <p className="mt-8 text-sm text-muted">
          Помодоро за сегодня: <span className="font-semibold text-text">{p.completedToday}</span>
        </p>
      </div>
    </Screen>
  );
}
