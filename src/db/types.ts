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
  completedAt: string | null;
  checklist: ChecklistItem[];
  recurrence: Recurrence | null;
  tags: string[];
  sortOrder: number;
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
  content: string; // markdown
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
