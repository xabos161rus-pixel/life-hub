// Базовые поля каждой записи — задел под облачную синхронизацию в v2:
// uuid, метки времени и мягкое удаление (deletedAt вместо физического delete).
export interface BaseEntity {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // обновляется при каждой записи
  deletedAt: string | null;
}

export type Priority = 0 | 1 | 2 | 3; // нет | низкий | средний | высокий

export interface Project extends BaseEntity {
  name: string;
  color: string; // hex
  emoji: string;
  sortOrder: number;
  archivedAt: string | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export type Recurrence =
  | { type: 'daily'; interval: number } // каждые N дней
  | { type: 'weekly'; interval: number; weekdays: number[] } // ISO 1=Пн..7=Вс
  | { type: 'monthly'; interval: number; dayOfMonth: number };

export interface Task extends BaseEntity {
  title: string;
  notes: string;
  projectId: string | null;
  goalId: string | null;
  priority: Priority;
  dueDate: string | null; // 'YYYY-MM-DD' (локальная дата)
  dueTime: string | null; // 'HH:mm' время дня, опционально (имеет смысл при dueDate)
  duration: number | null; // длительность в минутах (интервал «09:30 – 10:15»)
  remindBefore: number | null; // напомнить за N минут до dueTime; 0 = вовремя, null = выкл
  completedAt: string | null;
  checklist: ChecklistItem[];
  recurrence: Recurrence | null;
  tags: string[];
  sortOrder: number;
  // Сколько раз задачу отмечали «пропущена» (для статистики). undefined = 0.
  skippedCount?: number;
  // Заморозка: ISO-время постановки на паузу. null/undefined = активна.
  // Замороженная задача исключена из Today/статистики/активного списка и не
  // краснеет/желтеет — «как будто для неё остановилось время».
  frozenAt?: string | null;
}

export type GoalStatus = 'active' | 'completed' | 'paused' | 'archived';
export type GoalProgressMode = 'manual' | 'tasks' | 'numeric';

export interface Goal extends BaseEntity {
  title: string;
  description: string;
  targetDate: string | null; // 'YYYY-MM-DD'
  status: GoalStatus;
  progressMode: GoalProgressMode;
  progressManual: number; // 0..100, для mode='manual'
  targetValue: number | null; // для mode='numeric'
  currentValue: number | null;
  unitLabel: string; // подпись единиц для numeric, напр. «книг»
  color: string;
  sortOrder: number;
}

export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'weekdays'; weekdays: number[] } // ISO 1=Пн..7=Вс
  | { type: 'timesPerWeek'; times: number };

export interface Habit extends BaseEntity {
  name: string;
  emoji: string;
  color: string;
  schedule: HabitSchedule;
  goalId: string | null;
  archivedAt: string | null;
  sortOrder: number;
}

export interface HabitLog extends BaseEntity {
  habitId: string;
  date: string; // 'YYYY-MM-DD'; уникальный индекс [habitId+date]
}

export interface Note extends BaseEntity {
  title: string;
  content: string; // HTML (v1-заметки — markdown, мигрируют в HTML при первом открытии)
  tags: string[];
  pinned: boolean;
}

export type LearningKind =
  | 'book'
  | 'course'
  | 'article'
  | 'video'
  | 'research' // научная работа / исследование
  | 'language'; // иностранный язык
export type LearningStatus = 'planned' | 'inProgress' | 'done' | 'dropped';

export interface LearningItem extends BaseEntity {
  title: string;
  author: string;
  kind: LearningKind;
  status: LearningStatus;
  goalId: string | null;
  progressUnit: 'percent' | 'pages' | 'lessons';
  progressTarget: number; // 100 | всего страниц | всего уроков
  progressCurrent: number;
  notes: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface LearningLog extends BaseEntity {
  itemId: string;
  date: string; // 'YYYY-MM-DD'
  value: number; // абсолютное значение прогресса на эту дату
}

// === Финансы (#4) — ежемесячные траты и доходы ===
export type ExpenseKind = 'expense' | 'income';
export type ExpenseRecurrence = 'monthly' | 'weekly' | 'yearly' | 'oneoff';

export interface ExpenseItem extends BaseEntity {
  title: string;
  amount: number; // в рублях (валюта одна — ₽)
  kind: ExpenseKind;
  category: string; // Жильё, Еда, Подписки…
  recurrence: ExpenseRecurrence;
  dayOfMonth: number | null; // для monthly — день списания (опц.)
  notes: string;
  active: boolean; // учитывать в сводке
  sortOrder: number;
}

// === Восстановление и энергия (#3) ===
// effort — сколько сил требует способ: для сценария «совсем ничего не хочется»
// нужны low-effort варианты.
export type EnergyEffort = 'low' | 'medium' | 'high';

export interface EnergyItem extends BaseEntity {
  title: string;
  description: string;
  category: string; // Тело, Отдых, Общение, Природа, Творчество…
  effectiveness: number; // 1..5 — насколько хорошо работает для меня
  effort: EnergyEffort;
  sortOrder: number;
}

// === Места и путешествия (#6) — советы, опыт, рекомендации ===
export type PlaceKind = 'place' | 'thing' | 'tip' | 'food' | 'travel';
export type PlaceStatus = 'idea' | 'want' | 'done';

export interface PlaceItem extends BaseEntity {
  title: string;
  kind: PlaceKind;
  description: string; // совет/опыт/рекомендация
  source: string; // от кого совет
  location: string; // город/адрес (опц.)
  link: string; // ссылка (опц.)
  photo: string | null; // dataURL сжатого фото (опц.)
  tags: string[];
  status: PlaceStatus;
  sortOrder: number;
}

// === Метрики (#5) — произвольные измеримые показатели в динамике ===
export interface Metric extends BaseEntity {
  title: string;
  unit: string; // '%', 'кг', 'км'…
  currentValue: number;
  targetValue: number | null;
  color: string;
  sortOrder: number;
}

export interface MetricLog extends BaseEntity {
  metricId: string;
  date: string; // 'YYYY-MM-DD'
  value: number;
}

export interface Settings {
  id: 'app';
  theme: 'dark' | 'light' | 'system';
  weekStart: 1; // понедельник
  lastBackupAt: string | null;
  schemaVersion: number;
  updatedAt: string;
}

// === Семейный раздел (общие задачи + чат) ===
// Отдельное E2E-пространство: общий семейный ключ, шарится между ЛЮДЬМИ по QR.
// Источник истины — Durable Object на сервере (плотный seq), не личный D1-синк.

// Конфиг семьи (одна строка на группу). НЕ синкается, НЕ в бэкап (как
// SyncConfig — содержит ключ/токен). Первичный ключ id === familyId, поэтому
// у пользователя может быть несколько групп одновременно.
export interface FamilyConfig {
  id: string; // === familyId (первичный ключ строки)
  familyId: string;
  familyToken: string;
  familyKey: CryptoKey; // общий E2E-ключ семьи
  familyName: string;
  selfMemberId: string; // стабильный uuid этого пользователя в семье
  lastSeq: number; // курсор: последний полученный seq из DO-комнаты
  lastReadSeq: number; // до какого seq Я прочитал чат (для бейджа непрочитанного)
  enabled: boolean;
  joinedAt: string;
}

// Участник семьи. Синкается через DO (канал 'member'). seq — серверный порядок.
export interface FamilyMember {
  id: string; // memberId (uuid)
  familyId: string; // к какой группе относится
  seq: number;
  displayName: string;
  color: string;
  joinedAt: string;
  leftAt: string | null;
}

// Общая задача семьи. Можно ставить друг другу (assigneeId). Синк через DO ('task').
export interface FamilyTask {
  id: string;
  familyId: string; // к какой группе относится
  seq: number;
  title: string;
  notes: string;
  priority: Priority;
  dueDate: string | null; // 'YYYY-MM-DD'
  assigneeId: string | null; // кому поставлена
  createdBy: string; // кто поставил (memberId)
  completedAt: string | null;
  completedBy: string | null;
  sortOrder: number;
  deletedAt: string | null;
}

// Сообщение чата. append-only, дедуп по clientMsgId; порядок по серверному seq.
export interface FamilyMessage {
  clientMsgId: string; // uuid, первичный ключ
  familyId: string; // к какой группе относится
  seq: number | null; // null пока сервер не присвоил
  senderMemberId: string;
  createdAt: string;
  text: string;
  image?: string | null; // сжатый JPEG dataURL (если это сообщение-картинка)
  audio?: string | null; // аудио dataURL (голосовое сообщение)
  audioDur?: number; // длительность голосового, сек
  system?: boolean; // системное сообщение («X присоединился») — без пузыря
  status: 'pending' | 'sent' | 'acked'; // локальное состояние доставки (мимо синка)
  deletedAt: string | null;
}

// === Напоминания — закреплённые подсказки по темам (сворачиваемые разделы) ===
// Раздел (напр. «Работа») с набором напоминаний; раскрывается по ситуации.
export interface ReminderSection extends BaseEntity {
  title: string;
  collapsed: boolean;
  sortOrder: number;
}
export interface ReminderItem extends BaseEntity {
  sectionId: string;
  text: string; // может быть многострочным
  sortOrder: number;
}

// Конфиг E2E-синхронизации. НЕ синкается и НЕ входит в бэкап (содержит ключ
// и токен). key — extractable CryptoKey: нужно для повторного показа QR при
// подключении ещё одного устройства и резервного сохранения ключа.
export interface SyncConfig {
  id: 'config';
  accountId: string;
  authToken: string;
  key: CryptoKey;
  enabled: boolean;
  lastPullAt: string; // ISO-курсор: последний полученный updatedAt
  lastPushAt: string; // ISO-курсор: последний отправленный updatedAt
  lastSyncedAt: string; // ISO времени последнего успешного синка ('' — ни разу)
}
