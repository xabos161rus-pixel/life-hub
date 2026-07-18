import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Trash2,
} from 'lucide-react';
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

// Пользовательский шаблон длительности (создаётся/правится/удаляется юзером).
// Хранится в localStorage — рядом с состоянием помодоро, вне Dexie/бэкапа.
interface Preset {
  id: string;
  name: string;
  work: number;
  break: number;
  long: number;
}

const PRESETS_KEY = 'life-hub-pomodoro-presets';
const DEFAULT_PRESETS: Preset[] = [
  { id: 'def-25-5', name: '25 / 5', work: 25, break: 5, long: 15 },
  { id: 'def-50-10', name: '50 / 10', work: 50, break: 10, long: 15 },
  { id: 'def-90-20', name: '90 / 20', work: 90, break: 20, long: 20 },
];

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const arr = JSON.parse(raw) as Preset[];
    return Array.isArray(arr) ? arr : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

function savePresets(list: Preset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  } catch {
    /* квота */
  }
}

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
const MAX_MIN = 90; // базовый максимум круга (растёт под бо́льшие значения)
const STEP_MIN = 5; // шаг при перетаскивании кольца

// Перекрытие акцента приложения тёплой гаммой Focus To-Do — только в пределах
// экрана «Фокус»: кнопка, чипы, иконки и метка фазы наследуют его автоматически.
const FOCUS_VARS = {
  '--app-accent': 'var(--focus-accent)',
  '--app-accent-2': 'var(--focus-accent-2)',
  '--shadow-accent': 'var(--shadow-focus)',
} as unknown as CSSProperties;

/** Поле длительности (мин): шаг ±1 кнопками и ввод любого значения, без верхнего предела. */
function DurationStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  // Локальный текст: позволяет полностью стереть поле во время ввода (value=число
  // нельзя сделать пустым). Живое обновление — только при валидном числе ≥ 1;
  // пустое/невалидное на blur откатывается к текущему значению. Синхронизация с
  // внешним value (кнопки ±, пресеты, кольцо) — во время рендера, не в эффекте.
  const [text, setText] = useState(String(value));
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setText(String(value));
  }

  return (
    <div className="flex-1 rounded-2xl bg-surface-2 p-3">
      <p className="mb-2 text-center text-xs text-muted">{label}</p>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={`${label}: меньше`}
          onClick={() => onChange(Math.max(1, value - 1))}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-lg text-muted active:scale-90"
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={`${label}, минут`}
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '');
            setText(raw);
            const n = parseInt(raw, 10);
            if (raw !== '' && n >= 1) onChange(n);
          }}
          onBlur={() => {
            const n = parseInt(text, 10);
            if (!Number.isFinite(n) || n < 1) setText(String(value));
          }}
          className="w-14 bg-transparent text-center text-2xl font-bold tabular-nums outline-none"
        />
        <button
          type="button"
          aria-label={`${label}: больше`}
          onClick={() => onChange(value + 1)}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-lg text-muted active:scale-90"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Форма шаблона в нижнем шите: имя + три степпера + сохранить/удалить. */
function PresetForm({
  initial,
  onSave,
  onDelete,
}: {
  initial: Preset;
  onSave: (preset: Preset) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [work, setWork] = useState(initial.work);
  const [brk, setBrk] = useState(initial.break);
  const [long, setLong] = useState(initial.long);
  const fallbackName = `${work} / ${brk}`;

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div>
        <p className="mb-2 px-1 text-sm font-medium text-muted">Название</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={fallbackName}
          className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-base outline-none placeholder:text-muted"
        />
      </div>
      <div>
        <p className="mb-2 px-1 text-sm font-medium text-muted">Длительность (мин)</p>
        <div className="flex gap-3">
          <DurationStepper label="Фокус" value={work} onChange={setWork} />
          <DurationStepper label="Перерыв" value={brk} onChange={setBrk} />
        </div>
        <div className="mt-3 flex gap-3">
          <DurationStepper label="Длинный перерыв" value={long} onChange={setLong} />
          <div className="flex-1" />
        </div>
      </div>
      <button
        onClick={() => onSave({ ...initial, name: name.trim() || fallbackName, work, break: brk, long })}
        style={{ backgroundImage: 'linear-gradient(150deg, var(--focus-accent), var(--focus-accent-2))' }}
        className="rounded-2xl py-3 text-center font-semibold text-white active:opacity-95"
      >
        Сохранить
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          className="flex items-center justify-center gap-1.5 rounded-2xl border border-border py-3 text-center font-medium text-danger active:opacity-70"
        >
          <Trash2 size={16} /> Удалить
        </button>
      )}
    </div>
  );
}

export function FocusPage() {
  const p = usePomodoro();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [managing, setManaging] = useState(false);
  const [presetSheetOpen, setPresetSheetOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);

  const applyPreset = (pr: Preset) => {
    p.setDurations(pr.work, pr.break);
    p.setLongMin(pr.long);
  };
  const persistPresets = (next: Preset[]) => {
    setPresets(next);
    savePresets(next);
  };
  const openNewPreset = () => {
    setEditingPreset({ id: crypto.randomUUID(), name: '', work: p.workMin, break: p.breakMin, long: p.longMin });
    setPresetSheetOpen(true);
  };
  const openEditPreset = (pr: Preset) => {
    setEditingPreset(pr);
    setPresetSheetOpen(true);
  };
  const savePreset = (pr: Preset) => {
    persistPresets(
      presets.some((x) => x.id === pr.id) ? presets.map((x) => (x.id === pr.id ? pr : x)) : [...presets, pr],
    );
    setPresetSheetOpen(false);
  };
  const deletePreset = (id: string) => {
    persistPresets(presets.filter((x) => x.id !== id));
    setPresetSheetOpen(false);
  };
  const tasks = alive(useLiveQuery(() => db.tasks.toArray(), []) ?? []).filter(
    (t) => !t.completedAt,
  );

  const isWork = p.phase === 'work';
  // Метка фазы и «ручка» слайдера — сплошной цвет (акцент перекрыт тёплым ниже
  // по дереву); сама дуга в фокусе — красно-оранжевый градиент Focus To-Do.
  const accentColor = isWork ? 'var(--app-accent)' : 'var(--app-success)';
  const ringStroke = isWork ? 'url(#focusGrad)' : 'var(--app-success)';
  // Когда таймер не идёт и фаза «работа» — кольцо это слайдер длительности
  // (заполнение = workMin/ringMax); тянешь по кругу → меняешь время. Иначе — отсчёт.
  // ringMax растёт под значения больше 90 (длительность задаётся без верхнего предела).
  const idleWork = !p.running && isWork;
  const ringMax = Math.max(MAX_MIN, p.workMin);
  const ringFrac = idleWork
    ? Math.min(1, p.workMin / ringMax)
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
    const max = Math.max(MAX_MIN, p.workMin);
    let minutes = Math.round(((deg / 360) * max) / STEP_MIN) * STEP_MIN;
    minutes = Math.max(STEP_MIN, Math.min(max, minutes));
    p.setWorkMin(minutes);
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
      <div className="flex flex-col items-center" style={FOCUS_VARS}>
        <p className="mb-4 text-sm font-semibold" style={{ color: accentColor }}>
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
            <defs>
              <linearGradient id="focusGrad" gradientUnits="userSpaceOnUse" x1="150" y1="20" x2="150" y2="280">
                <stop offset="0%" stopColor="var(--focus-accent)" />
                <stop offset="100%" stopColor="var(--focus-accent-2)" />
              </linearGradient>
            </defs>
            <circle cx="150" cy="150" r={R} fill="none" stroke="var(--app-hairline)" strokeWidth={STROKE} />
            <circle
              cx="150"
              cy="150"
              r={R}
              fill="none"
              stroke={ringStroke}
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
                fill={accentColor}
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
              <span className="mt-1 text-xs text-muted">крутите кольцо ↻</span>
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
            style={{
              backgroundImage: 'linear-gradient(150deg, var(--focus-accent), var(--focus-accent-2))',
              boxShadow: 'var(--shadow-focus)',
            }}
            className="flex size-20 items-center justify-center rounded-full text-white active:scale-90"
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
          <div className="flex gap-3">
            <DurationStepper label="Фокус" value={p.workMin} onChange={p.setWorkMin} />
            <DurationStepper label="Перерыв" value={p.breakMin} onChange={p.setBreakMin} />
          </div>
          <div className="mt-3 flex gap-3">
            <DurationStepper label="Длинный перерыв" value={p.longMin} onChange={p.setLongMin} />
            <p className="flex-1 self-center px-1 text-xs leading-snug text-muted">
              Длинный перерыв включается после каждых 4 фокусов.
            </p>
          </div>
          <div className="mb-2 mt-5 flex items-center justify-between px-1">
            <p className="text-sm font-medium text-muted">Шаблоны</p>
            <button
              onClick={() => setManaging((v) => !v)}
              className="text-sm font-medium text-accent active:opacity-60"
            >
              {managing ? 'Готово' : 'Изменить'}
            </button>
          </div>
          <ChipRow>
            {presets.map((pr) => (
              <Chip
                key={pr.id}
                active={
                  !managing && pr.work === p.workMin && pr.break === p.breakMin && pr.long === p.longMin
                }
                onClick={() => (managing ? openEditPreset(pr) : applyPreset(pr))}
              >
                <span className="flex items-center gap-1">
                  {managing && <Pencil size={13} />}
                  {pr.name}
                </span>
              </Chip>
            ))}
            <button
              onClick={openNewPreset}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border px-3.5 py-1.5 text-sm font-medium text-muted active:opacity-70"
            >
              <Plus size={14} /> Шаблон
            </button>
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

      <Sheet
        open={presetSheetOpen}
        onClose={() => setPresetSheetOpen(false)}
        title={
          editingPreset && presets.some((x) => x.id === editingPreset.id)
            ? 'Изменить шаблон'
            : 'Новый шаблон'
        }
      >
        {editingPreset && (
          <PresetForm
            key={editingPreset.id}
            initial={editingPreset}
            onSave={savePreset}
            onDelete={
              presets.some((x) => x.id === editingPreset.id)
                ? () => deletePreset(editingPreset.id)
                : undefined
            }
          />
        )}
      </Sheet>
    </Screen>
  );
}
