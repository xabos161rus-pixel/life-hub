import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { todayKey } from '../../lib/dates';

// Помодоро-таймер на основе timestamp (endsAt) — корректно показывает остаток
// после сворачивания приложения и навигации. Состояние глобальное (контекст),
// чтобы мини-таймер был виден из любого раздела. Звук — Web Audio (без файлов).

export type Phase = 'work' | 'break' | 'long';

const LONG_AFTER = 4; // длинный перерыв после стольких рабочих сессий
const LONG_MIN = 15;

interface Persisted {
  phase: Phase;
  running: boolean;
  endsAt: number | null; // когда running
  remainingMs: number; // когда на паузе
  taskId: string | null;
  taskTitle: string | null;
  workCount: number;
  completedToday: number;
  date: string;
  workMin: number;
  breakMin: number;
}

interface PomodoroCtx {
  phase: Phase;
  running: boolean;
  remainingMs: number;
  totalMs: number;
  taskId: string | null;
  taskTitle: string | null;
  completedToday: number;
  workMin: number;
  breakMin: number;
  active: boolean; // идёт сессия (не дефолтное простаивание)
  start: (taskId?: string | null, taskTitle?: string | null) => void;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  setDurations: (workMin: number, breakMin: number) => void;
}

const STORE_KEY = 'life-hub-pomodoro';
const Ctx = createContext<PomodoroCtx | null>(null);

function phaseMs(phase: Phase, workMin: number, breakMin: number): number {
  if (phase === 'work') return workMin * 60_000;
  if (phase === 'long') return LONG_MIN * 60_000;
  return breakMin * 60_000;
}

function load(): Persisted {
  const base: Persisted = {
    phase: 'work',
    running: false,
    endsAt: null,
    remainingMs: 25 * 60_000,
    taskId: null,
    taskTitle: null,
    workCount: 0,
    completedToday: 0,
    date: todayKey(),
    workMin: 25,
    breakMin: 5,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const p = { ...base, ...(JSON.parse(raw) as Persisted) };
    if (p.date !== todayKey()) p.completedToday = 0; // счётчик помодоро — за сегодня
    return p;
  } catch {
    return base;
  }
}

let beepCtx: AudioContext | null = null;
function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!beepCtx) beepCtx = new AC();
    void beepCtx.resume();
    const o = beepCtx.createOscillator();
    const g = beepCtx.createGain();
    o.connect(g);
    g.connect(beepCtx.destination);
    o.type = 'sine';
    o.frequency.value = 880;
    const t = beepCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.start(t);
    o.stop(t + 0.6);
  } catch {
    /* звук недоступен */
  }
  navigator.vibrate?.(200);
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Persisted>(load);
  const sRef = useRef(s);
  sRef.current = s;

  const persist = useCallback((next: Persisted) => {
    setS(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* квота */
    }
  }, []);

  const total = phaseMs(s.phase, s.workMin, s.breakMin);
  const remainingMs = s.running && s.endsAt != null ? Math.max(0, s.endsAt - Date.now()) : s.remainingMs;

  // Тик раз в 500мс, пока идёт; пересчёт из endsAt — устойчив к сворачиванию.
  const [, force] = useState(0);
  useEffect(() => {
    if (!s.running) return;
    const id = setInterval(() => {
      const cur = sRef.current;
      if (!cur.running || cur.endsAt == null) return;
      if (cur.endsAt - Date.now() <= 0) advancePhase();
      else force((n) => n + 1);
    }, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.running, s.endsAt]);

  // Пересчёт при возврате в приложение (когда таймеры в фоне стояли).
  useEffect(() => {
    const onVis = () => {
      const cur = sRef.current;
      if (cur.running && cur.endsAt != null && cur.endsAt - Date.now() <= 0) advancePhase();
      else force((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function advancePhase() {
    const cur = sRef.current;
    beep();
    if (cur.phase === 'work') {
      const workCount = cur.workCount + 1;
      const completedToday = cur.completedToday + 1;
      const nextPhase: Phase = workCount % LONG_AFTER === 0 ? 'long' : 'break';
      // перерыв запускаем автоматически
      persist({
        ...cur,
        phase: nextPhase,
        workCount,
        completedToday,
        date: todayKey(),
        running: true,
        endsAt: Date.now() + phaseMs(nextPhase, cur.workMin, cur.breakMin),
        remainingMs: phaseMs(nextPhase, cur.workMin, cur.breakMin),
      });
    } else {
      // конец перерыва → готов к новой работе, ждём старта
      persist({
        ...cur,
        phase: 'work',
        running: false,
        endsAt: null,
        remainingMs: cur.workMin * 60_000,
      });
    }
  }

  const start: PomodoroCtx['start'] = useCallback(
    (taskId = null, taskTitle = null) => {
      const cur = sRef.current;
      const ms = phaseMs('work', cur.workMin, cur.breakMin);
      persist({
        ...cur,
        phase: 'work',
        running: true,
        endsAt: Date.now() + ms,
        remainingMs: ms,
        taskId,
        taskTitle,
        date: todayKey(),
      });
      beep(); // разблокировать аудио жестом пользователя (тихо стартует и контекст)
    },
    [persist],
  );

  const toggle = useCallback(() => {
    const cur = sRef.current;
    if (cur.running) {
      persist({ ...cur, running: false, endsAt: null, remainingMs: Math.max(0, (cur.endsAt ?? Date.now()) - Date.now()) });
    } else {
      const rem = cur.remainingMs > 0 ? cur.remainingMs : phaseMs(cur.phase, cur.workMin, cur.breakMin);
      persist({ ...cur, running: true, endsAt: Date.now() + rem, remainingMs: rem });
    }
  }, [persist]);

  const reset = useCallback(() => {
    const cur = sRef.current;
    persist({
      ...cur,
      phase: 'work',
      running: false,
      endsAt: null,
      remainingMs: cur.workMin * 60_000,
      taskId: null,
      taskTitle: null,
      workCount: 0,
    });
  }, [persist]);

  const skip = useCallback(() => {
    advancePhase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDurations = useCallback(
    (workMin: number, breakMin: number) => {
      const cur = sRef.current;
      persist({
        ...cur,
        workMin,
        breakMin,
        remainingMs: cur.running ? cur.remainingMs : workMin * 60_000,
      });
    },
    [persist],
  );

  const active = s.running || s.remainingMs < total || s.phase !== 'work';

  return (
    <Ctx.Provider
      value={{
        phase: s.phase,
        running: s.running,
        remainingMs,
        totalMs: total,
        taskId: s.taskId,
        taskTitle: s.taskTitle,
        completedToday: s.completedToday,
        workMin: s.workMin,
        breakMin: s.breakMin,
        active,
        start,
        toggle,
        reset,
        skip,
        setDurations,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function usePomodoro(): PomodoroCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePomodoro must be used within PomodoroProvider');
  return c;
}

/** «25:00» из миллисекунд. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
