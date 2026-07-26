// Встроенный справочник симптомов. Список сознательно короткий: у Flo их
// заявлено под сотню, но каждый лишний пункт — это лишняя секунда на ввод, а
// заполняемость и есть вход всех расчётов раздела. Начинаем с того, что
// покрывает большинство записей, и даём добавлять своё.
//
// hkIdentifier проставлен там, где в HealthKit есть точное соответствие: это
// задел на экспорт в «Здоровье» и одновременно проверка, что мы не выдумали
// категорию, которой нет ни у кого.

import type { SymptomDef, SymptomGroup } from '../../db/cycleTypes';

type Seed = Omit<SymptomDef, 'createdAt' | 'updatedAt' | 'builtIn' | 'enabled' | 'order'>;

const SEED: Seed[] = [
  // --- Телесные ---
  {
    key: 'cramps',
    group: 'somatic',
    scale: 'severity',
    label: 'Спазмы внизу живота',
    hkIdentifier: 'HKCategoryTypeIdentifierAbdominalCramps',
  },
  {
    key: 'headache',
    group: 'somatic',
    scale: 'severity',
    label: 'Головная боль',
    hkIdentifier: 'HKCategoryTypeIdentifierHeadache',
  },
  {
    key: 'lower_back_pain',
    group: 'somatic',
    scale: 'severity',
    label: 'Боль в пояснице',
    hkIdentifier: 'HKCategoryTypeIdentifierLowerBackPain',
  },
  {
    key: 'breast_tenderness',
    group: 'somatic',
    scale: 'severity',
    label: 'Чувствительность груди',
    hkIdentifier: 'HKCategoryTypeIdentifierBreastPain',
  },
  {
    key: 'fatigue',
    group: 'somatic',
    scale: 'severity',
    label: 'Усталость',
    hkIdentifier: 'HKCategoryTypeIdentifierFatigue',
  },
  {
    key: 'hot_flashes',
    group: 'somatic',
    scale: 'severity',
    label: 'Приливы',
    hkIdentifier: 'HKCategoryTypeIdentifierHotFlashes',
  },

  // --- Пищеварение и аппетит ---
  {
    key: 'bloating',
    group: 'gi',
    scale: 'severity',
    label: 'Вздутие',
    hkIdentifier: 'HKCategoryTypeIdentifierBloating',
  },
  {
    key: 'nausea',
    group: 'gi',
    scale: 'severity',
    label: 'Тошнота',
    hkIdentifier: 'HKCategoryTypeIdentifierNausea',
  },
  {
    key: 'appetite_change',
    group: 'gi',
    scale: 'presence',
    label: 'Изменение аппетита',
    hkIdentifier: 'HKCategoryTypeIdentifierAppetiteChanges',
  },
  {
    key: 'constipation',
    group: 'gi',
    scale: 'presence',
    label: 'Запор',
    hkIdentifier: 'HKCategoryTypeIdentifierConstipation',
  },
  {
    key: 'diarrhea',
    group: 'gi',
    scale: 'presence',
    label: 'Послабление стула',
    hkIdentifier: 'HKCategoryTypeIdentifierDiarrhea',
  },

  // --- Настроение ---
  // Отмечаем факт и силу, но НЕ выводим из них диагнозов и не строим
  // «прогноз настроения»: это ровно тот детерминизм, за который трекеры
  // справедливо ругают.
  {
    key: 'mood_swings',
    group: 'mood',
    scale: 'severity',
    label: 'Перепады настроения',
    hkIdentifier: 'HKCategoryTypeIdentifierMoodChanges',
  },
  {
    key: 'irritability',
    group: 'mood',
    scale: 'severity',
    label: 'Раздражительность',
  },
  {
    key: 'anxiety',
    group: 'mood',
    scale: 'severity',
    label: 'Тревожность',
  },
  {
    key: 'low_mood',
    group: 'mood',
    scale: 'severity',
    label: 'Подавленность',
  },

  // --- Кожа ---
  {
    key: 'acne',
    group: 'skin',
    scale: 'presence',
    label: 'Высыпания',
    hkIdentifier: 'HKCategoryTypeIdentifierAcne',
  },

  // --- Сон ---
  {
    key: 'insomnia',
    group: 'sleep',
    scale: 'presence',
    label: 'Плохо спалось',
    hkIdentifier: 'HKCategoryTypeIdentifierSleepChanges',
  },

  // --- Мочеполовое ---
  {
    key: 'pelvic_pain',
    group: 'repro',
    scale: 'severity',
    label: 'Тазовая боль',
    hkIdentifier: 'HKCategoryTypeIdentifierPelvicPain',
  },
  {
    key: 'vaginal_dryness',
    group: 'repro',
    scale: 'presence',
    label: 'Сухость',
    hkIdentifier: 'HKCategoryTypeIdentifierVaginalDryness',
  },
];

export const SYMPTOM_GROUP_LABELS: Record<SymptomGroup, string> = {
  somatic: 'Тело',
  gi: 'Пищеварение',
  mood: 'Настроение',
  skin: 'Кожа',
  sleep: 'Сон',
  urinary: 'Мочевыделение',
  repro: 'Половая система',
  custom: 'Свои',
};

/** Полный список встроенных симптомов с проставленным порядком.
 *  Порядок задаётся позицией в SEED — так он виден в одном месте и не
 *  разъезжается при добавлении новых пунктов. */
export function builtInSymptoms(now: string): SymptomDef[] {
  return SEED.map((s, i) => ({
    ...s,
    builtIn: true,
    enabled: true,
    order: (i + 1) * 10, // с зазором: пользовательские вставляются между
    createdAt: now,
    updatedAt: now,
  }));
}

export const BUILT_IN_KEYS: readonly string[] = SEED.map((s) => s.key);
