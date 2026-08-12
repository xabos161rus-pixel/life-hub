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
  // Подпроект: id родительского проекта. null/undefined — верхний уровень.
  // Глубина ограничена двумя уровнями: проект → подпроекты.
  parentId?: string | null;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export type Recurrence =
  | { type: 'daily'; interval: number } // каждые N дней
  | { type: 'weekly'; interval: number; weekdays: number[] } // ISO 1=Пн..7=Вс
  | { type: 'monthly'; interval: number; dayOfMonth: number }
  | { type: 'yearly'; interval: number }; // каждые N лет от исходной даты (дни рождения)

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
  // Фото задачи: сжатые JPEG dataURL (как в «Местах»/чате). undefined = нет.
  photos?: string[];
  // Кто породил задачу. undefined — человек сам. 'cycle' — раздел «Женские дни».
  // Помеченные задачи наследуют приватность породившего раздела: они не уходят
  // ни в какой обмен и исключаются из экспорта, даже если сам список задач
  // когда-нибудь научится делиться. Плюс по этому полю раздел находит свои
  // задачи, чтобы подвинуть их при сдвиге прогноза.
  origin?: 'cycle';
  // Ключ шаблона внутри раздела: по нему находим ровно ту задачу, которую
  // пора обновить, вместо того чтобы плодить дубли на каждый пересчёт.
  originKey?: string;
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
  // Количественная цель за день: null — простая привычка-галочка; > 0 — счётчик
  // (например 30 «раз», 5 «км»). unit — подпись единицы (пусто для галочки).
  target: number | null;
  unit: string;
  goalId: string | null;
  archivedAt: string | null;
  sortOrder: number;
  /** Интервалы заморозки, по возрастанию from. to отсутствует — заморозка идёт сейчас.
   *  origin: 'manual' — человек заморозил сам из шита; 'section' — выключение
   *  раздела «Привычки» заморозило все привычки разом (при включении раздела
   *  снимаются только эти, ручные остаются). */
  frozenRanges?: Array<{ from: string; to?: string; origin: 'manual' | 'section' }>;
}

export interface HabitLog extends BaseEntity {
  habitId: string;
  date: string; // 'YYYY-MM-DD'; уникальный индекс [habitId+date]
  // Значение за день для количественной привычки; null — простая отметка-галочка.
  value: number | null;
}

export interface Note extends BaseEntity {
  title: string;
  content: string; // HTML (v1-заметки — markdown, мигрируют в HTML при первом открытии)
  tags: string[];
  pinned: boolean;
  // В какой папке лежит. null/undefined — «Все заметки», корень. Один уровень
  // вложенности намеренно: папка в папке в папке — это то, из-за чего люди
  // перестают раскладывать вообще и сваливают всё в корень.
  folderId?: string | null;
}

/** Чанк файла-вложения заметки.
 *
 *  Файл целиком в одну запись не помещается: записи синкаются через D1, а там
 *  значение одной колонки ≤ 2 МБ (см. cloudBackup.ts). Поэтому dataURL режется
 *  кусками splitDataUrl (те же 400 КиБ сырых байт, что в семейном чате) и
 *  собирается assembleFile при чтении. Метаданные (имя/тип/размер/total)
 *  дублируются в каждом чанке: отдельная запись-манифест дала бы ещё одну
 *  сущность и гонку «манифест доехал, чанки нет» на ровном месте.
 *
 *  Картинок это не касается: они живут инлайном в Note.content (сжатый JPEG
 *  dataURL в <img>), как фото в чате и «Местах». */
export interface NoteFile extends BaseEntity {
  noteId: string;
  /** Общий id файла у всех его чанков (uuid). */
  fileId: string;
  idx: number;
  total: number;
  name: string;
  mime: string;
  /** Размер исходного файла в байтах (не чанка). */
  size: number;
  /** Кусок dataURL. */
  data: string;
}

/** Папка заметок. Плоский список, без вложенности. */
export interface NoteFolder extends BaseEntity {
  name: string;
  // Цвет и эмодзи — чтобы папка узнавалась с одного взгляда, а не читалась.
  emoji: string;
  color: string;
  sortOrder: number;
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

// === Накопления — трекер целей-копилок ===
export interface SavingsGoal extends BaseEntity {
  title: string;
  emoji: string;
  color: string; // hex
  targetAmount: number; // цель в рублях
  targetDate: string | null; // 'YYYY-MM-DD' — срок (опц.), для прогноза «в месяц»
  note: string;
  archivedAt: string | null; // «Забрать»: цель завершена и убрана из активных
  sortOrder: number;
}

// Пополнение цели. amount может быть отрицательным (снятие/откат). Накоплено по
// цели = сумма её вкладов; отдельным полем не храним, чтобы не рассинхронизировать.
export interface SavingsDeposit extends BaseEntity {
  goalId: string;
  amount: number; // рубли; < 0 — снятие
  date: string; // 'YYYY-MM-DD'
  note: string;
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

/** Профиль владельца приложения.
 *
 *  Живёт внутри Settings, а не отдельной таблицей: запись ровно одна, и своя
 *  таблица ради одной строки только добавила бы миграцию. Поле не
 *  индексируется — значит и миграция Dexie не нужна.
 *
 *  Вес одним текущим значением, без истории замеров. История — это отдельная
 *  таблица, экран динамики и связка с «Энергией», то есть самостоятельная
 *  задача; здесь достаточно того, что человек написал о себе. */
export interface UserProfile {
  name?: string;
  /** Сжатый JPEG в dataURL — как фото в чате и «Местах». */
  avatar?: string | null;
  birthDate?: string | null; // 'YYYY-MM-DD'
  heightCm?: number | null;
  weightKg?: number | null;
}

export interface Settings {
  id: 'app';
  theme: 'dark' | 'light' | 'system';
  weekStart: 1; // понедельник
  lastBackupAt: string | null;
  schemaVersion: number;
  profile?: UserProfile;
  /** Пол — обязательный выбор при первом запуске (GenderGate). Определяет
   *  набор разделов: «Женские дни» существуют только в женском профиле.
   *  Отсутствие значения = выбор ещё не сделан, приложение закрыто гейтом.
   *  Меняется потом в профиле; данные скрытых разделов при смене не удаляются. */
  gender?: 'female' | 'male';
  /** Версия, список изменений которой человек уже видел. Отсутствует у тех,
   *  кто пользовался приложением до появления окна «что нового». */
  lastSeenVersion?: string;
  updatedAt: string;
  // Обучение: ISO-время завершения вводного тура. null/undefined — не пройден,
  // при первом запуске поверх приложения показывается OnboardingOverlay.
  onboardingDone?: string | null;
  // Показанные контекстные подсказки (id из useHint) — каждая всплывает один
  // раз при первом использовании раздела и скрывается крестиком навсегда.
  seenHints?: string[];
  // Свёрнутые группы раздела «Задачи»: id проектов/подпроектов, '__none__'
  // (Без проекта), '__frozen__' (Заморожено). Device-local (settings не
  // синкается) — свёрнутость это предпочтение конкретного экрана. Раньше жило в
  // localStorage, но на iOS-PWA оно не переживало перезапуск и состояние слетало;
  // перенесено в IndexedDB, где надёжно хранится остальное UI-состояние.
  collapsedProjects?: string[];
  // Положение плавающей кнопки «+» (Fab), если пользователь перетащил её под себя.
  // {x,y} — левый-верхний угол кнопки в px вьюпорта, кламп по границам при рендере.
  // null/undefined — дефолт (правый нижний угол над таб-баром). Device-local
  // (settings не синкается) — у каждого человека своё удобное место.
  fabPosition?: { x: number; y: number } | null;
  // Раскладка навигации «под себя»: разделы нижней панели (bottom, по порядку,
  // без якоря «Главной»), спрятанные (hidden) и порядок разделов внутри «Главной» (more).
  // Строки-id из lib/sections. undefined — раскладка по умолчанию. Device-local,
  // нормализуется через computeNavLayout (битый конфиг не ломает навигацию).
  navConfig?: { bottom: string[]; hidden: string[]; more?: string[] };
  // ISO-время, когда пользователь закрыл одноразовое окно о смене имени/значка
  // (LifeHearth). Показывается только тем, кто уже пользовался приложением до
  // ребрендинга (onboardingDone стоит, а этот флаг ещё нет). Новым пользователям
  // проставляется вместе с onboardingDone — им переустановка не нужна.
  reinstallNoticeSeen?: string | null;
  // Звук нового сообщения чата при открытом приложении (lib/sounds.ts).
  // undefined = 'tritone'. Для закрытого приложения звук пуша — системный.
  messageSound?: 'tritone' | 'ding' | 'pop' | 'none';
  // Рингтон входящего звонка (lib/family/ringtone.ts). undefined = 'classic'.
  callSound?: 'classic' | 'soft' | 'bright';
  // Автоматическая резервная копия. 'cloud' — зашифрованный снапшот аккаунта
  // на сервер (нужна включённая синхронизация). undefined/'off' — выключено.
  autoBackup?: 'off' | 'cloud';
  autoBackupEvery?: 'daily' | 'weekly';
  lastCloudBackupAt?: string | null; // ISO последней успешной облачной копии
  // Когда автокопия отказалась перезаписывать облако: там лежит копия полнее
  // нашей. Не ошибка сети — осознанный отказ, и человек должен о нём узнать,
  // иначе автокопия молча не работает месяцами.
  cloudBackupBlocked?: string | null;
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
  // Порядок групп в переключателе (перетаскивание в «Управлении группами»).
  // undefined — старые записи; сортируются в хвост по joinedAt.
  sortOrder?: number;
  // Штамп для репликации подключения между СВОИМИ устройствами через аккаунтный
  // E2E-синк (запись familyShare): ставится при создании/входе в группу.
  // Курсоры lastSeq/lastReadSeq не реплицируются — они на каждом устройстве свои.
  updatedAt?: string;
  // --- исключение участника и смена ключа ---
  // Номер текущей эпохи ключа. 0 (или отсутствует) — группа создана до
  // появления ротации: шифротекст без префикса эпохи, ключ один.
  keyEpoch?: number;
  // Все известные эпохи: номер → ключ. Нужен, чтобы после смены ключа
  // продолжать читать прежнюю переписку. Текущая эпоха дублируется здесь же,
  // familyKey остаётся быстрым доступом к ней.
  keyRing?: Record<string, CryptoKey>;
  // Личная пара участника (ECDH): по ней владелец адресно передаёт новый ключ
  // группы. Публичная часть уходит всем через канал 'member'.
  boxPub?: string;
  boxPriv?: string;
  // Секрет владельца группы. Есть ТОЛЬКО у того, кто группу создал: в
  // приглашение не попадает, между своими устройствами едет аккаунтным синком.
  // Сервер хранит его хеш и по нему пускает исключать участников.
  ownerSecret?: string;
  // Кто владелец. Закрепляется один раз при регистрации на сервере и больше не
  // меняется: по этому ключу проверяется, что конверт с новым ключом группы
  // прислал именно владелец, а не сервер и не другой участник.
  ownerMemberId?: string;
  // Этого участника исключили из группы. Локальные данные не стираем — прошлая
  // переписка остаётся читаемой, но соединение больше не поднимается.
  removedAt?: string;
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
  // Публичный ключ участника для адресных конвертов с новым ключом группы.
  // Едет через шифрованный канал 'member' — значит сервер его не подменит.
  // Пусто у тех, кто не обновился: таким новый ключ передать невозможно.
  boxPub?: string;
  // Когда участника исключили. Отличается от leftAt («ушёл сам»): исключённый
  // остаётся в списке зачёркнутым, чтобы прошлые сообщения было к кому отнести.
  removedAt?: string | null;
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
  // Отметку «выполнена» не удалось отправить (не было сети) — при переотправке
  // её нужно снова пометить для пуша, иначе она доедет молча и остальные не
  // узнают. Поле локальное, наружу не уходит: stripMeta его вырезает.
  pendingNotify?: 'done';
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
  // Ответ: сниппет оригинала внутри payload (E2E). Тап по цитате скроллит к id.
  replyTo?: { id: string; name: string; text: string } | null;
  // Сообщение-реакция: не рендерится пузырём, агрегируется по targetId.
  // Последняя реакция участника на target побеждает; emoji '' — снятие.
  reaction?: { targetId: string; emoji: string } | null;
  editedAt?: string | null; // метка «изменено»
  status: 'pending' | 'sent' | 'acked'; // локальное состояние доставки (мимо синка)
  deletedAt: string | null;
  /** Сообщение-файл (манифест): описание без содержимого. Содержимое едет
   *  отдельными сообщениями-чанками и собирается по fileId. */
  file?: { fileId: string; name: string; mime: string; size: number; chunksTotal: number } | null;
  /** Собранный (или исходный у отправителя) файл целиком, dataURL. Есть только
   *  локально после сборки всех чанков; в payload манифеста НЕ входит. */
  fileData?: string | null;
  /** Кусок файла. Такие сообщения не рендерятся пузырём вовсе. */
  fileChunk?: { fileId: string; idx: number; total: number; data: string } | null;
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
  // Набор таблиц, который знала версия приложения, двигавшая курсор. Нужен
  // ровно для одного: заметить, что после обновления мы умеем больше, чем
  // умели, — и переспросить сервер с нуля. См. lib/sync.ts.
  knownTables?: string[];
  lastPushAt: string; // ISO-курсор: последний отправленный updatedAt
  lastSyncedAt: string; // ISO времени последнего успешного синка ('' — ни разу)
}
