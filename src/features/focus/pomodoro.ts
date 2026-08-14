import { createContext, useContext } from 'react';
import { t } from '../../lib/i18n';

// Контекст, хук и форматтеры помодоро вынесены из PomodoroProvider.tsx:
// файл с компонентом должен экспортировать только компоненты,
// иначе ломается Fast Refresh (react-refresh/only-export-components).

export type Phase = 'work' | 'break' | 'long';
export type SoundType = 'none' | 'white' | 'pink' | 'brown' | 'rain';

export interface PomodoroCtx {
  phase: Phase;
  running: boolean;
  remainingMs: number;
  totalMs: number;
  taskId: string | null;
  taskTitle: string | null;
  completedToday: number;
  focusMinToday: number;
  workMin: number;
  breakMin: number;
  longMin: number;
  sound: SoundType;
  active: boolean; // идёт сессия (не дефолтное простаивание)
  start: (taskId?: string | null, taskTitle?: string | null) => void;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  setDurations: (workMin: number, breakMin: number) => void;
  setWorkMin: (workMin: number) => void;
  setBreakMin: (breakMin: number) => void;
  setLongMin: (longMin: number) => void;
  setTask: (taskId: string | null, taskTitle: string | null) => void;
  setSound: (sound: SoundType) => void;
}

export const Ctx = createContext<PomodoroCtx | null>(null);

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

/** «1 ч 25 мин» / «25 мин» из минут — для статистики фокуса. */
export function formatFocusTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}\u00A0${t('мин')}`;
  return m === 0 ? `${h}\u00A0${t('ч')}` : `${h}\u00A0${t('ч')} ${m}\u00A0${t('мин')}`;
}
