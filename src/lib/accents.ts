// Акцентные темы: имена и цвета для превью в настройках. Значения обязаны
// совпадать с CSS-блоками [data-accent] в index.css — превью показывает
// кружки КАЖДОГО акцента, а не только активного, поэтому var(--app-accent)
// тут не годится и дублирование неизбежно.

import type { Settings } from '../db/types';

export type AccentId = NonNullable<Settings['accent']>;

export interface AccentDef {
  id: AccentId;
  label: string;
  hint: string;
  /** Кружки превью [акцент, пара, заливка] для тёмной и светлой темы. */
  dark: [string, string, string];
  light: [string, string, string];
}

export const ACCENTS: AccentDef[] = [
  {
    id: 'indigo',
    label: 'Индиго',
    hint: 'сине-фиолетовый',
    dark: ['oklch(0.72 0.18 264)', 'oklch(0.67 0.21 300)', 'oklch(0.562 0.18 264)'],
    light: ['oklch(0.515 0.17 266)', 'oklch(0.56 0.18 292)', 'oklch(0.563 0.17 266)'],
  },
  {
    id: 'emerald',
    label: 'Изумруд',
    hint: 'спокойный зелёный',
    dark: ['oklch(0.695 0.16 158)', 'oklch(0.64 0.17 130)', 'oklch(0.55 0.125 158)'],
    light: ['oklch(0.469 0.11 158)', 'oklch(0.523 0.14 130)', 'oklch(0.55 0.125 158)'],
  },
  {
    id: 'sunset',
    label: 'Закат',
    hint: 'тёплый красный',
    dark: ['oklch(0.73 0.165 27)', 'oklch(0.666 0.165 55)', 'oklch(0.592 0.215 27)'],
    light: ['oklch(0.495 0.2 27)', 'oklch(0.546 0.14 52)', 'oklch(0.593 0.225 27)'],
  },
];
