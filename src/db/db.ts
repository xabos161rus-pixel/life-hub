import Dexie, { type Table } from 'dexie';
import type {
  Project,
  Task,
  Goal,
  Habit,
  HabitLog,
  Note,
  LearningItem,
  LearningLog,
  Settings,
} from './types';

export const SCHEMA_VERSION = 1;

export class LifeHubDB extends Dexie {
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  goals!: Table<Goal, string>;
  habits!: Table<Habit, string>;
  habitLogs!: Table<HabitLog, string>;
  notes!: Table<Note, string>;
  learningItems!: Table<LearningItem, string>;
  learningLogs!: Table<LearningLog, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('life-hub');
    this.version(SCHEMA_VERSION).stores({
      projects: 'id, sortOrder',
      tasks: 'id, projectId, goalId, dueDate, completedAt',
      goals: 'id, status',
      habits: 'id, goalId',
      habitLogs: 'id, habitId, date, &[habitId+date]',
      notes: 'id, *tags, pinned',
      learningItems: 'id, status, goalId',
      learningLogs: 'id, itemId, date',
      settings: 'id',
    });
  }
}

export const db = new LifeHubDB();

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  theme: 'dark',
  weekStart: 1,
  lastBackupAt: null,
  schemaVersion: SCHEMA_VERSION,
  updatedAt: new Date().toISOString(),
};

/** Создаёт строку настроек при первом запуске. Вызывается из main.tsx. */
export async function ensureSettings(): Promise<void> {
  const existing = await db.settings.get('app');
  if (!existing) await db.settings.put(DEFAULT_SETTINGS);
}
