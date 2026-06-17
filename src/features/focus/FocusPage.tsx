import { useRef, useState, type PointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, ListChecks, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { Screen } from '../../components/layout/Screen';
import { Sheet } from '../../components/ui/Sheet';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  formatClock,
  formatFocusTime,
  usePomodoro,
  type Phase,
  type SoundType,
} from './PomodoroProvider';

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

const SOUNDS: { value: SoundType; label: string }[] = [
  { value: 'none', label: 'Тишина' },
  { value: 'white', label: 'Белый' },
  { value: 'pink', label: 'Розовый' },
  { value: 'brown', label: 'Коричневый' },
  { value: 'rain', label: 'Дождь' },
];

const R = 130;
const STROKE = 12;
const CIRC = 2 * Math.PI * R;
const MAX_MIN = 90; // полный круг = 90 мин
const STEP_MIN = 5; // шаг при перетаскивании

export function FocusPage() {
  const p = usePomodoro();
  const [pickerOpen, setPickerOpen] = useState(false);
  const tasks = alive(useLiveQuery(() => db.tasks.toArray(), []) ?? []).filter(
    (t) => !t.completedAt,
  );

  const ringColor = p.phase === 'work' ? 'var(--app-accent)' : 'var(--app-success)';
  // Когда таймер не идёт и фаза «работа» — кольцо это слайдер длительности
  // (заполнение = workMin/MAX); тянешь по кругу → меняешь время. Иначе — отсчёт.
  const idleWork = !p.running && p.phase === 'work';
  const ringFrac = idleWork
    ? Math.min(1, p.workMin / MAX_MIN)
    : p.totalMs > 0
      ? 1 - p.remainingMs / p.totalMs
      : 0;
  const handleA = 2 * Math.PI * ringFrac;
  const handleX = 150 + R * Math.sin(handleA);
  const handleY = 150 - R * Math.cos(handleA);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  function setFromPointer(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let deg = (Math.atan2(clientX - cx, -(clientY - cy)) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    let minutes = Math.round(((deg / 360) * MAX_MIN) / STEP_MIN) * STEP_MIN;
    minutes = Math.max(STEP_MIN, Math.min(MAX_MIN, minutes));
    p.setDurations(minutes, p.breakMin);
  }

  const onRingDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!idleWork) return;
    dragging.current = true;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже неактивен */
    }
    setFromPointer(e.clientX, e.clientY);
  };
  const onRingMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current || !idleWork) return;
    setFromPointer(e.clientX, e.clientY);
  };
  const onRingUp = () => {
    dragging.current = false;
  };

  return (
    <Screen title="Фокус" backTo="/more">
      <div className="flex flex-col items-center">
        <p className="mb-4 text-sm font-semibold" style={{ color: ringColor }}>
          {PHASE_LABEL[p.phase]}
        </p>

        <div className="relative">
          <svg
            ref={svgRef}
            viewBox="0 0 300 300"
            className="w-64 max-w-[72vw]"
            style={{ touchAction: idleWork ? 'none' : 'auto' }}
            onPointerDown={onRingDown}
            onPointerMove={onRingMove}
            onPointerUp={onRingUp}
            onPointerCancel={onRingUp}
          >
            <circle cx="150" cy="150" r={R} fill="none" stroke="var(--app-hairline)" strokeWidth={STROKE} />
            <circle
              cx="150"
              cy="150"
              r={R}
              fill="none"
              stroke={ringColor}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - ringFrac)}
              transform="rotate(-90 150 150)"
              style={{ transition: p.running ? 'stroke-dashoffset 0.5s linear' : 'none' }}
            />
            {idleWork && (
              <circle
                cx={handleX}
                cy={handleY}
                r={13}
                fill={ringColor}
                stroke="var(--app-bg)"
                strokeWidth={3}
              />
            )}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-5xl font-bold tabular-nums tracking-tight">
              {formatClock(p.remainingMs)}
            </span>
            {p.taskTitle ? (
              <span className="mt-1 max-w-[60%] truncate text-sm text-muted">{p.taskTitle}</span>
            ) : idleWork ? (
              <span className="mt-1 text-xs text-muted">крути кольцо ↻</span>
            ) : null}
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

        {/* Выбор задачи фокуса */}
        <button
          onClick={() => setPickerOpen(true)}
          className="card mt-8 flex w-full items-center gap-3 px-4 py-3 active:opacity-80"
        >
          <ListChecks size={20} className="shrink-0 text-accent" />
          <span className={`min-w-0 flex-1 truncate text-left ${p.taskTitle ? '' : 'text-muted'}`}>
            {p.taskTitle || 'Выбрать задачу'}
          </span>
          <ChevronRight size={18} className="shrink-0 text-muted" />
        </button>

        <div className="mt-6 w-full">
          <p className="mb-2 px-1 text-sm font-medium text-muted">Звук фокуса</p>
          <ChipRow>
            {SOUNDS.map((sd) => (
              <Chip key={sd.value} active={p.sound === sd.value} onClick={() => p.setSound(sd.value)}>
                {sd.label}
              </Chip>
            ))}
          </ChipRow>
        </div>

        <div className="mt-6 w-full">
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

        <div className="mt-8 flex w-full gap-3">
          <div className="flex-1 rounded-2xl bg-surface-2 p-3 text-center">
            <p className="text-2xl font-bold">{p.completedToday}</p>
            <p className="text-xs text-muted">помодоро сегодня</p>
          </div>
          <div className="flex-1 rounded-2xl bg-surface-2 p-3 text-center">
            <p className="text-2xl font-bold">{formatFocusTime(p.focusMinToday)}</p>
            <p className="text-xs text-muted">фокуса сегодня</p>
          </div>
        </div>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Задача для фокуса">
        <div className="flex flex-col">
          <button
            onClick={() => {
              p.setTask(null, null);
              setPickerOpen(false);
            }}
            className="border-b border-hairline py-3 text-left text-muted active:opacity-60"
          >
            Без задачи
          </button>
          {tasks.length === 0 ? (
            <EmptyState icon={ListChecks} title="Нет активных задач" />
          ) : (
            tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  p.setTask(t.id, t.title);
                  setPickerOpen(false);
                }}
                className="border-b border-hairline py-3 text-left active:opacity-60"
              >
                {t.title}
              </button>
            ))
          )}
        </div>
      </Sheet>
    </Screen>
  );
}
