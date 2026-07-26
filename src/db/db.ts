import Dexie, { type Table } from 'dexie';
import type {
  Project,
  Task,
  Goal,
  Habit,
  HabitLog,
  Note,
  NoteFolder,
  LearningItem,
  LearningLog,
  ExpenseItem,
  SavingsGoal,
  SavingsDeposit,
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
  ReminderSection,
  ReminderItem,
} from './types';
import type {
  Cycle,
  CycleDayLog,
  CycleEpisode,
  CycleOverride,
  CyclePrediction,
  CycleSettings,
  SymptomDef,
} from './cycleTypes';

export const SCHEMA_VERSION = 13;

export class LifeHubDB extends Dexie {
  projects!: Table<Project, string>;
  tasks!: Table<Task, string>;
  goals!: Table<Goal, string>;
  habits!: Table<Habit, string>;
  habitLogs!: Table<HabitLog, string>;
  notes!: Table<Note, string>;
  noteFolders!: Table<NoteFolder, string>;
  learningItems!: Table<LearningItem, string>;
  learningLogs!: Table<LearningLog, string>;
  expenseItems!: Table<ExpenseItem, string>;
  savingsGoals!: Table<SavingsGoal, string>;
  savingsDeposits!: Table<SavingsDeposit, string>;
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
  reminderSections!: Table<ReminderSection, string>;
  reminderItems!: Table<ReminderItem, string>;
  // Раздел «Женские дни». Ключ дневной записи и цикла — строка даты, а не uuid:
  // на календарный день приходится ровно одна запись, суррогатный id позволил
  // бы завести вторую. Эти таблицы НЕ входят в SYNCED_TABLES (lib/sync.ts) и
  // пишутся мимо db/repo — см. lib/cycle/cycleRepo.ts.
  cycleDays!: Table<CycleDayLog, string>;
  cycles!: Table<Cycle, string>;
  cycleOverrides!: Table<CycleOverride, string>;
  cycleEpisodes!: Table<CycleEpisode, string>;
  cycleSettings!: Table<CycleSettings, string>;
  cycleSymptoms!: Table<SymptomDef, string>;
  cyclePredictions!: Table<CyclePrediction, string>;

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
    // v6 — несколько семейных групп одновременно. Конфиг теперь по ключу
    // familyId (много строк вместо одной 'config'), а семейные данные
    // размечаются полем familyId (+ индекс для выборки по группе).
    this.version(6)
      .stores({
        family: 'id',
        familyMembers: 'id, familyId, seq',
        familyTasks: 'id, familyId, seq, assigneeId, completedAt',
        familyMessages: 'clientMsgId, familyId, seq, createdAt',
      })
      .upgrade(async (tx) => {
        // Перекладываем единственную старую группу на новую модель: строку
        // конфига id='config' перекеиваем в id=familyId, а все её данные
        // (они принадлежали ровно этой группе) штампуем тем же familyId.
        const cfg = await tx.table('family').get('config');
        if (!cfg) return;
        const fid: string = cfg.familyId;
        await tx.table('family').delete('config');
        await tx.table('family').put({ ...cfg, id: fid, lastReadSeq: cfg.lastReadSeq ?? 0 });
        for (const t of ['familyMembers', 'familyTasks', 'familyMessages']) {
          await tx
            .table(t)
            .toCollection()
            .modify((row: { familyId?: string }) => {
              if (!row.familyId) row.familyId = fid;
            });
        }
      });
    // v7 — напоминания: разделы по темам + закреплённые подсказки. Только новые
    // таблицы, существующие не трогаются → upgrade-функция не нужна.
    this.version(7).stores({
      reminderSections: 'id, sortOrder',
      reminderItems: 'id, sectionId, sortOrder',
    });
    // v8 — подпроекты: parentId у проекта (+ индекс для выборки детей).
    // Существующие проекты нормализуются в parentId=null (верхний уровень).
    this.version(8)
      .stores({ projects: 'id, sortOrder, parentId' })
      .upgrade((tx) =>
        tx
          .table('projects')
          .toCollection()
          .modify((p) => {
            if (p.parentId === undefined) p.parentId = null;
          }),
      );
    // v9 — количественные привычки: target/unit у привычки и value у отметки.
    // Индексы не меняются; существующие записи нормализуем (простые галочки).
    this.version(9)
      .stores({
        habits: 'id, goalId',
        habitLogs: 'id, habitId, date, &[habitId+date]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('habits')
          .toCollection()
          .modify((h) => {
            if (h.target === undefined) h.target = null;
            if (h.unit === undefined) h.unit = '';
          });
        await tx
          .table('habitLogs')
          .toCollection()
          .modify((l) => {
            if (l.value === undefined) l.value = null;
          });
      });
    // v10 — накопления: цели-копилки и пополнения. Только новые таблицы,
    // существующие не трогаются → upgrade-функция не нужна.
    this.version(10).stores({
      savingsGoals: 'id, sortOrder, archivedAt',
      savingsDeposits: 'id, goalId, date',
    });
    // v11 — раздел «Женские дни». Только новые таблицы, существующие не
    // трогаются → upgrade-функция не нужна.
    //
    // cycleDays.date первичным ключом даёт уникальность записи на день без
    // отдельного индекса и корректный between('2026-01-01','2026-07-25'):
    // лексикографический порядок ISO-дат совпадает с хронологическим.
    // isBleedingDay — 0|1, потому что boolean в индекс IndexedDB не попадает
    // вообще. *symptomKeys — multi-entry: «все дни, когда болела голова» одним
    // проходом вместо скана истории.
    // [excluded+startDate] — основной запрос статистики: последние N
    // неисключённых циклов. Без составного индекса это скан всех циклов с
    // фильтром в JS; на трёх годах терпимо, на импорте за десять лет уже нет.
    this.version(11).stores({
      cycleDays: 'date, isBleedingDay, *symptomKeys',
      cycles: 'startDate, endDate, [excluded+startDate]',
      cycleOverrides: 'startDate',
      cycleEpisodes: 'id, kind, startDate',
      cycleSettings: 'id',
      // enabled в индекс НЕ идёт: это boolean, а IndexedDB индексирует только
      // числа, строки, даты и массивы. Симптомов пара десятков — фильтруем в JS.
      cycleSymptoms: 'key, group',
      cyclePredictions: 'forCycleStart',
    });
    // v12 — происхождение задачи. Индекс по origin нужен, чтобы раздел находил
    // свои автозадачи одним запросом, а не сканом всего списка; и чтобы
    // проверка «не утекло ли что-то из закрытого раздела» была дешёвой.
    // Существующие задачи не трогаем: undefined означает «человек сам создал».
    this.version(12).stores({
      tasks: 'id, projectId, goalId, dueDate, completedAt, *tags, origin',
    });

    // Папки заметок. Один уровень вложенности намеренно: папка в папке в папке
    // — самый быстрый способ добиться того, что человек перестанет
    // раскладывать вообще и свалит всё в корень.
    // У существующих заметок folderId остаётся undefined — это и есть корень,
    // переносить ничего не нужно.
    this.version(13)
      .stores({
        noteFolders: 'id, sortOrder',
        notes: 'id, *tags, pinned, folderId',
      })
      .upgrade(async (tx) => {
        // Помечаем уже существующую строку настроек как «старого» пользователя.
        //
        // Экраны онбординга появились только в этом релизе, поля onboardingDone
        // в прежних настройках нет вовсе, а ensureSettings пишет строку лишь
        // когда её нет целиком. Без этой строчки человек, у которого приложение
        // стоит давно и полно данных, после тихого обновления получил бы
        // вводный тур для новичка поверх собственных задач — и, что хуже,
        // окно «Новое имя и значок» не показалось бы уже никогда: оно ждёт
        // пройденного онбординга.
        //
        // Дата — не «сейчас», а заведомо прошлая: онбординг человек не проходил,
        // и притворяться, что прошёл сегодня, значит соврать в собственных
        // данных. Важен только факт «не новичок».
        await tx
          .table('settings')
          .toCollection()
          .modify((row: { onboardingDone?: string }) => {
            if (row.onboardingDone === undefined) row.onboardingDone = '2000-01-01T00:00:00.000Z';
          });
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
