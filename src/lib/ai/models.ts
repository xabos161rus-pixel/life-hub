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

// id и цены сверены с прайсом Polza.ai 18.08.2026 (страница «Модели»):
// числа «от N ₽ за 1M» — нижняя ставка агрегатора, реальный счёт придёт в
// usage ответа, поэтому подпись под ответом остаётся оценкой. Эндпоинт:
// https://polza.ai/api/v1/chat/completions (значение AI_PROVIDER_URL).
// Sonnet 5 — рабочая модель по умолчанию из плана (§3 «Следствия для v1»);
// Sonnet 4.6 — дешёвый вариант; Opus 5 — осознанно, для сложных разборов.
export const MODELS: ModelInfo[] = [
  { id: 'echo', label: 'Заглушка (бесплатно)', priceIn: 0, priceOut: 0 },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', priceIn: 235, priceOut: 1174 },
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', priceIn: 162, priceOut: 812 },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', priceIn: 587, priceOut: 2935 },
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
