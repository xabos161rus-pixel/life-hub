// Реестр моделей и расчёт стоимости.
//
// Пока подключена только заглушка-эхо, поэтому список из одной записи и цены
// нулевые. Живые модели добавляются здесь же вместе с адаптером провайдера —
// реестр держим константой в коде, а не таблицей в БД: одна запись на модель,
// меняется только при обновлении приложения, в синк и бэкап ей не место.
//
// Цены — в РУБЛЯХ за миллион токенов, уже с наценкой провайдера. Так стоимость
// сразу в той валюте, в которой её видно на счёте, без курса внутри клиента.

import { t } from '../i18n';

export interface ModelInfo {
  id: string;
  label: string;
  priceIn: number; // ₽ за 1M входных токенов
  priceOut: number; // ₽ за 1M выходных токенов
}

// ⚠️ id и цены живых моделей — СВЕРИТЬ с прайсом провайдера при настройке
// ключа (шаг §8 плана): id должны совпадать со списком моделей агрегатора
// (формат OpenRouter-стиля), цены ниже — ориентир от прайса Anthropic
// (Sonnet $3/$15, Haiku $1/$5 за 1M) по курсу ~90 ₽/$ с наценкой ~6%.
// Стоимость под ответом считается от этих чисел — пока они не сверены,
// относиться к ней как к оценке.
export const MODELS: ModelInfo[] = [
  { id: 'echo', label: 'Заглушка (бесплатно)', priceIn: 0, priceOut: 0 },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet', priceIn: 290, priceOut: 1440 },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku', priceIn: 96, priceOut: 480 },
];

// Дефолт — заглушка: без ключа провайдера живые модели вернут ошибку, а
// тракт и тесты должны работать из коробки. После настройки ключа модель
// выбирается в самом чате (и запоминается в нём).
export const DEFAULT_MODEL = 'echo';

export function modelById(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function modelLabel(id: string | null): string {
  if (!id) return '';
  return t(modelById(id)?.label ?? id);
}

/** Стоимость запроса в рублях. null, если модель незнакомая (цену не выдумываем). */
export function costRub(modelId: string | null, tokensIn: number, tokensOut: number): number | null {
  const m = modelId ? modelById(modelId) : undefined;
  if (!m) return null;
  return (tokensIn * m.priceIn + tokensOut * m.priceOut) / 1_000_000;
}

/** «12,34 ₽» / «0,02 ₽» / «бесплатно» — короткая подпись под ответом. */
export function formatCost(rub: number | null): string {
  if (rub === null) return '';
  if (rub === 0) return t('бесплатно');
  if (rub < 0.01) return '<0,01 ₽';
  return `${rub.toFixed(2).replace('.', ',')} ₽`;
}
