// Модель данных раздела «Женские дни». Вынесена из types.ts отдельным файлом
// намеренно: у раздела свой репозиторий (lib/cycle/cycleRepo.ts), свои таблицы
// и свой запрет на синхронизацию — держать его сущности вперемешку с
// задачами и заметками значило бы приглашать случайное «а давайте и это
// засинкаем». Подробное обоснование модели — docs/cycle-tracking-research.md.
//
// Отличие от остальных сущностей приложения: они наследуют BaseEntity с
// id: string. Здесь первичный ключ дневной записи — сама дата, а цикла — дата
// его первого дня. Причина: на день приходится ровно одна запись, и суррогатный
// id только позволил бы завести вторую запись на тот же день.

/** Локальная календарная дата, 'YYYY-MM-DD'. Никогда не Date.
 *
 *  Date в IndexedDB — это момент времени в UTC. При перелёте, смене таймзоны
 *  или переходе на летнее время выборка by-range начала бы отдавать соседний
 *  день, а «день цикла» съезжал бы на единицу. Строка ISO-даты сравнивается
 *  лексикографически ровно в том же порядке, что хронологически, поэтому
 *  between('2026-01-01','2026-07-25') всегда корректен. */
export type LocalDate = string;

/** ISO-8601 с таймзоной. Только для аудита и разрешения конфликтов при
 *  синхронизации. В расчётах цикла не участвует никогда. */
export type Instant = string;

/** Уровень кровотечения за день.
 *
 *  Одна шкала вместо принятого у Apple и Google разделения на «поток» и
 *  «межменструальное кровотечение»: человеку проще выбрать одно значение из
 *  пяти, чем понять, в какое из двух полей писать. Семантика восстанавливается
 *  расчётом — spotting не открывает цикл и не входит в длительность
 *  менструации, а попав вне менструации, классифицируется как межменструальное
 *  кровотечение. Цена решения — маппинг в HealthKit перестаёт быть взаимно
 *  однозначным (см. HK_FLOW и HK_INTERMENSTRUAL ниже). */
export type BleedingLevel = 'none' | 'spotting' | 'light' | 'medium' | 'heavy';

/** Кровотечение, которое считается менструальным. */
export const MENSTRUAL_LEVELS: readonly BleedingLevel[] = ['light', 'medium', 'heavy'];

/** 1..3 — слабо / умеренно / сильно. Совпадает с HKCategoryValueSeverity
 *  (mild=2, moderate=3, severe=4) со сдвигом на единицу. */
export type Severity = 1 | 2 | 3;

export type MucusAppearance = 'dry' | 'sticky' | 'creamy' | 'watery' | 'eggwhite' | 'unusual';
export type MucusSensation = 'light' | 'medium' | 'heavy';

export type OvulationTestResult = 'negative' | 'lh_surge' | 'estrogen_surge' | 'indeterminate';
export type PregnancyTestResult = 'negative' | 'positive' | 'indeterminate';

export type ContraceptiveMethod =
  | 'oral'
  | 'patch'
  | 'ring'
  | 'injection'
  | 'implant'
  | 'iud_hormonal'
  | 'iud_copper'
  | 'barrier'
  | 'other'
  | 'unspecified';

export interface SymptomEntry {
  /** Ссылка на SymptomDef.key. */
  key: string;
  /** Отсутствует у симптомов со шкалой 'presence'. */
  severity?: Severity;
}

export type SymptomGroup =
  | 'somatic'
  | 'gi'
  | 'mood'
  | 'skin'
  | 'sleep'
  | 'urinary'
  | 'repro'
  | 'custom';

export interface SymptomDef {
  key: string;
  group: SymptomGroup;
  /** 'presence' — было или нет; 'severity' — плюс степень 1..3. */
  scale: 'presence' | 'severity';
  label: string;
  /** Идентификатор HealthKit для будущего экспорта. Нет у пользовательских. */
  hkIdentifier?: string;
  builtIn: boolean;
  /** Пользователь прячет лишнее, не удаляя историю. */
  enabled: boolean;
  order: number;
  createdAt: Instant;
  updatedAt: Instant;
}

/** Дневная запись — единственный источник истины раздела.
 *  Всё остальное (циклы, прогнозы, статистика) из неё выводится. */
export interface CycleDayLog {
  /** Первичный ключ: одна запись на календарный день. */
  date: LocalDate;

  /** Три состояния различаются и НЕ схлопываются в nullable:
   *   undefined — пользователь в этот день ничего не отмечал;
   *   'none'    — явно отметил, что кровотечения не было;
   *   остальное — уровень.
   *  Разница принципиальна: «нет данных» не закрывает менструацию, а явное
   *  «не было» — закрывает. Схлопнув их, мы получили бы менструации длиной
   *  во весь цикл у любого, кто пропустил пару дней. */
  bleeding?: BleedingLevel;

  /** Денормализованный список ключей симптомов — только ради multi-entry
   *  индекса. Держится в синхроне с symptoms в единственном месте записи
   *  (cycleRepo.putDay), руками не трогать. */
  symptomKeys?: string[];
  symptoms?: SymptomEntry[];

  mucus?: { appearance?: MucusAppearance; sensation?: MucusSensation };

  /** Базальная температура, °C. */
  bbtC?: number;
  /** Измерение исключено из расчётов: болезнь, алкоголь, мало сна, поздний замер. */
  bbtExcluded?: boolean;
  bbtExcludeReason?: 'illness' | 'poor_sleep' | 'late_measurement' | 'alcohol' | 'other';

  ovulationTest?: OvulationTestResult;
  pregnancyTest?: PregnancyTestResult;

  /** Специальная категория персональных данных (ст. 10 152-ФЗ — интимная
   *  жизнь). Категория выключена по умолчанию и включается явно. */
  intimacy?: { count?: number; protection?: 'protected' | 'unprotected' | 'unknown' };

  contraceptiveTaken?: boolean;

  note?: string;

  /** 0 | 1 вместо boolean: IndexedDB индексирует числа, строки, даты и
   *  массивы — boolean в индекс не попадает вообще. Вычисляется при записи из
   *  bleeding и позволяет искать границы менструаций без полного скана. */
  isBleedingDay: 0 | 1;

  createdAt: Instant;
  updatedAt: Instant;
  /** Запись сделана не в тот день, к которому относится. Нужно для честной
   *  оценки заполняемости: подсказки и корреляции показываем только при
   *  достаточном покрытии, а массово проставленное задним числом покрытие
   *  качество данных не улучшает. */
  backdated?: boolean;
  source: 'user' | 'import';
}

export type CycleStatus = 'current' | 'complete' | 'needs_confirmation';

export type CycleExcludeReason =
  | 'user'
  | 'pregnancy'
  | 'loss'
  | 'emergency_contraception'
  | 'hormonal_method'
  | 'illness'
  | 'data_gaps'
  | 'imported_uncertain';

/** Цикл — производная сущность, детерминированный кэш над дневными записями.
 *
 *  Хранится, а не считается на лету, ради одного запроса: «последние 12
 *  неисключённых циклов» для прогноза и статистики. На трёхлетней истории
 *  скан дней ещё терпим, на импортированной десятилетней — уже нет.
 *  Цена: кэш можно рассинхронизировать, поэтому пересчёт обязан быть
 *  идемпотентным, а пользовательские правки (исключение цикла, подтверждение
 *  даты начала) обязаны переживать пересчёт — они лежат в отдельной таблице
 *  cycleOverrides и накладываются поверх. */
export interface Cycle {
  /** Первичный ключ — дата первого дня. Уникальна по построению. */
  startDate: LocalDate;

  /** Последний день цикла. undefined — текущий незавершённый. */
  endDate?: LocalDate;
  /** Длина в днях. undefined у текущего цикла: у него ещё нет длины, и
   *  подставлять сюда «сколько прошло» нельзя — это разные величины, и
   *  усреднять их вместе значит занижать среднюю длину. */
  lengthDays?: number;

  periodEndDate?: LocalDate;
  periodLengthDays?: number;

  status: CycleStatus;

  excluded: 0 | 1;
  excludeReason?: CycleExcludeReason;

  /** Внутри цикла есть дни без записей там, где ожидалось кровотечение. */
  hasDataGaps: 0 | 1;
  /** Пользователь подтвердил дату начала после вопроса о пропусках. */
  startConfirmed: 0 | 1;

  /** Когда кэш пересчитан. */
  derivedAt: Instant;
}

/** Пользовательская правка поверх вычисленного цикла.
 *
 *  Живёт отдельно от Cycle именно потому, что Cycle пересчитывается с нуля:
 *  если хранить «исключён» внутри кэша, первый же пересчёт сотрёт решение
 *  пользователя. Ключ — дата начала цикла, к которому правка относится. */
export interface CycleOverride {
  startDate: LocalDate;
  excluded?: 0 | 1;
  excludeReason?: CycleExcludeReason;
  startConfirmed?: 0 | 1;
  note?: string;
  createdAt: Instant;
  updatedAt: Instant;
}

export type EpisodeKind =
  | 'pregnancy'
  | 'postpartum'
  | 'lactational_amenorrhea'
  /** Непрерывный приём, ЛНГ-ВМС, имплант — методы, при которых менструаций
   *  может не быть вовсе. */
  | 'hormonal_suppression'
  | 'loss'
  | 'other_medical';

/** Интервал, в течение которого цикла в обычном смысле нет.
 *
 *  Без этой сущности наивный алгоритм на беременности покажет «задержка
 *  240 дней», а на комбинированных контрацептивах будет считать кровотечение
 *  отмены менструацией и рисовать фертильное окно там, где овуляции нет.
 *  Внутри эпизода прогноз, фертильность и детекция отклонений выключены, а
 *  пересекающиеся циклы исключаются из статистики. */
export interface CycleEpisode {
  id: string;
  kind: EpisodeKind;
  startDate: LocalDate;
  /** undefined — эпизод продолжается. */
  endDate?: LocalDate;
  note?: string;
  createdAt: Instant;
  updatedAt: Instant;
}

export type CycleMode =
  | 'tracking'
  | 'ttc'
  | 'pregnancy'
  | 'postpartum'
  | 'contraception'
  | 'perimenopause'
  /** Отслеживание симптомов без кровотечений вообще. */
  | 'no_bleeding';

/** Возрастная группа — исключительно ради возрастных порогов регулярности
 *  FIGO. Точную дату рождения не спрашиваем: она не нужна для расчёта, а
 *  как персональные данные стоит дороже. Поле опционально; без него берётся
 *  самый мягкий порог. */
export type AgeBand = 'under_18' | '18_25' | '26_41' | '42_45' | 'over_45';

export interface CycleSettings {
  id: 'app';

  mode: CycleMode;

  /** Глобальный выключатель прогнозов. Части людей прогноз не помогает, а
   *  раздражает: при нерегулярном цикле он промахивается раз за разом. */
  predictionsEnabled: boolean;
  /** Фертильность выключена по умолчанию везде, кроме режима планирования:
   *  показывать «фертильное окно» тому, кто пришёл считать дни до месячных,
   *  значит навязывать чужую цель. */
  fertilityDisplay: 'off' | 'window' | 'probability_map';

  contraception?: {
    method: ContraceptiveMethod;
    regimen?: '21+7' | '24+4' | 'continuous' | 'not_applicable';
    startedOn?: LocalDate;
  };

  ageBand?: AgeBand;

  /** Час, с которого приложение считает начавшимся новый день, подставляя
   *  дату по умолчанию. Влияет ТОЛЬКО на подстановку: сама дата всегда видна
   *  и редактируема. Случай ночной смены (отметка в 02:00 — это какой день)
   *  решается настройкой, а не догадкой приложения. */
  dayStartHour: number;

  // --- Приватность. Все значения по умолчанию — самые закрытые. ---
  lock: 'none' | 'pin' | 'device_credential';
  hideFromNavigation: boolean;
  showOnTodayScreen: boolean;
  neutralNotificationText: boolean;
  includeInGeneralBackup: boolean;
  syncEnabled: boolean;

  /** Связки с другими разделами. Каждая включается отдельно и выключена
   *  по умолчанию: связка полезна тем, кто её попросил, и навязчива всем
   *  остальным. */
  integrations: {
    todayCard: boolean;
    calendarMarks: boolean;
    energyCorrelation: boolean;
    habitsCorrelation: boolean;
    autoTasks: boolean;
    planningHints: boolean;
  };

  onboardedAt?: Instant;
  disclaimerAcceptedAt?: Instant;
  updatedAt: Instant;
}

/** Запись прогноза — нужна, чтобы потом сверить его с реальностью.
 *
 *  Ни один разобранный конкурент не показывает собственную точность. Мы
 *  сохраняем каждый прогноз и после начала цикла проставляем фактическую
 *  ошибку: это превращает выбор алгоритма из вкусовщины в измеримый факт
 *  для конкретного человека и позволяет честно сказать «на твоих данных мы
 *  ошибаемся на 2 дня». */
export interface CyclePrediction {
  /** Прогноз сделан для цикла, начавшегося в эту дату. */
  forCycleStart: LocalDate;
  predictedNextStart: LocalDate;
  lo50: LocalDate;
  hi50: LocalDate;
  lo80: LocalDate;
  hi80: LocalDate;
  method: 'population_prior' | 'blended' | 'personal';
  nCyclesUsed: number;
  sigmaUsed: number;
  /** Проставляется постфактум, когда цикл реально начался. */
  actualNextStart?: LocalDate;
  errorDays?: number;
  hitIn80?: 0 | 1;
  createdAt: Instant;
}

/** Маппинг нашей шкалы кровотечения на HKCategoryValueVaginalBleeding.
 *  Нужен для будущего экспорта в Здоровье; сейчас не используется, но
 *  зафиксирован, пока перечни свежи. Обратное преобразование неоднозначно:
 *  из HealthKit spotting придёт как unspecified потока либо как отдельная
 *  запись intermenstrualBleeding — см. HK_INTERMENSTRUAL. */
export const HK_FLOW: Record<Exclude<BleedingLevel, 'none' | 'spotting'>, string> = {
  light: 'HKCategoryValueVaginalBleedingLight',
  medium: 'HKCategoryValueVaginalBleedingMedium',
  heavy: 'HKCategoryValueVaginalBleedingHeavy',
};

/** Тип записи HealthKit, в который уходит spotting за пределами менструации. */
export const HK_INTERMENSTRUAL = 'HKCategoryTypeIdentifierIntermenstrualBleeding';
