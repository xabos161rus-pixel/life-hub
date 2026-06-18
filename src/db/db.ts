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
  ExpenseItem,
  EnergyItem,
  PlaceItem,
  Metric,
  MetricLog,
  Settings,
  SyncConfig,
  FamilyConfig,
  FamilyMember,
  FamilyTask,
  FamilyMessage,
} from './types';

export const SCHEMA_VERSION = 5;

export class LifeHubDB extends Dexie {
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  goals!: Table<Goal, string>;
  habits!: Table<Habit, string>;
  habitLogs!: Table<HabitLog, string>;
  notes!: Table<Note, string>;
  learningItems!: Table<LearningItem, string>;
  learningLogs!: Table<LearningLog, string>;
  expenseItems!: Table<ExpenseItem, string>;
  energyItems!: Table<EnergyItem, string>;
  placeItems!: Table<PlaceItem, string>;
  metrics!: Table<Metric, string>;
  metricLogs!: Table<MetricLog, string>;
  settings!: Table<Settings, string>;
  sync!: Table<SyncConfig, string>;
  family!: Table<FamilyConfig, string>;
  familyMembers!: Table<FamilyMember, string>;
  familyTasks!: Table<FamilyTask, string>;
  familyMessages!: Table<FamilyMessage, string>;

  constructor() {
    super('life-hub');
    this.version(1).stores({
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
    // v2 — новые разделы жизни (финансы, энергия, места, метрики).
    // Существующие таблицы не меняются, поэтому upgrade-функция не нужна.
    this.version(2).stores({
      expenseItems: 'id, category, kind',
      energyItems: 'id, category',
      placeItems: 'id, kind, status',
      metrics: 'id',
      metricLogs: 'id, metricId, date',
    });
    // v3 — теги у задач (multiEntry-индекс *tags для фильтра).
    this.version(3)
      .stores({ tasks: 'id, projectId, goalId, dueDate, completedAt, *tags' })
      .upgrade((tx) =>
        tx
          .table('tasks')
          .toCollection()
          .modify((t) => {
            if (!Array.isArray(t.tags)) t.tags = [];
          }),
      );
    // v4 — конфиг E2E-синхронизации (одна строка id='config'). Новая таблица,
    // существующие не меняются → upgrade-функция не нужна.
    this.version(4).stores({ sync: 'id' });
    // v5 — семейный раздел (общие задачи + чат). Только новые таблицы,
    // существующие не трогаются → upgrade-функция не нужна.
    this.version(5).stores({
      family: 'id',
      familyMembers: 'id, seq',
      familyTasks: 'id, seq, assigneeId, completedAt',
      familyMessages: 'clientMsgId, seq, createdAt',
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
