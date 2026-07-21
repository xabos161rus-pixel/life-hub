import {
  Sun,
  ListTodo,
  NotebookText,
  Users,
  LayoutGrid,
  Sparkles,
  Timer,
  CalendarCheck,
  Target,
  GraduationCap,
  Wallet,
  BatteryCharging,
  MapPin,
  ChartColumnBig,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

// Единый реестр разделов навигации. Раньше данные были разбросаны между TabBar
// и MorePage; теперь один источник, из которого собираются и нижняя панель, и
// список «Ещё», и экран настройки. Пользователь перекладывает разделы между
// панелью и «Ещё» и прячет ненужные — раскладка живёт в settings (device-local).

export type SectionId =
  | 'today'
  | 'tasks'
  | 'notes'
  | 'family'
  | 'more'
  | 'capture'
  | 'focus'
  | 'habits'
  | 'goals'
  | 'learning'
  | 'finance'
  | 'energy'
  | 'places'
  | 'stats'
  | 'settings';

export interface Section {
  id: SectionId;
  label: string; // короткая метка (нижняя панель)
  to: string; // маршрут
  icon: LucideIcon;
  end?: boolean; // точное совпадение маршрута для активной подсветки NavLink
  /** «Ещё» — контейнер: всегда последний слот панели, не прячется, не в списке «Ещё». */
  anchor?: boolean;
  /** Нельзя спрятать (Сегодня — стартовый экран, Настройки — вход в саму настройку). */
  nonHideable?: boolean;
  /** Подпись в списке «Ещё» (у Сегодня/Задач/Заметок/Семьи её не показываем). */
  subtitle?: string;
}

export const SECTIONS: Section[] = [
  { id: 'today', label: 'Сегодня', to: '/', icon: Sun, end: true, nonHideable: true },
  { id: 'tasks', label: 'Задачи', to: '/tasks', icon: ListTodo },
  { id: 'notes', label: 'Заметки', to: '/notes', icon: NotebookText, subtitle: 'Быстрые записи и списки' },
  { id: 'family', label: 'Семья', to: '/more/family', icon: Users, subtitle: 'Общие задачи, чат и звонки' },
  {
    id: 'capture',
    label: 'Захват',
    to: '/share',
    icon: Sparkles,
    subtitle: 'Вставить текст → задача или заметка',
  },
  { id: 'focus', label: 'Фокус', to: '/more/focus', icon: Timer, subtitle: 'Таймер помодоро' },
  {
    id: 'habits',
    label: 'Привычки',
    to: '/more/habits',
    icon: CalendarCheck,
    subtitle: 'Ежедневные ритуалы и серии',
  },
  { id: 'goals', label: 'Цели', to: '/goals', icon: Target, subtitle: 'Большие цели и прогресс' },
  {
    id: 'learning',
    label: 'Обучение',
    to: '/more/learning',
    icon: GraduationCap,
    subtitle: 'Книги, курсы и языки',
  },
  { id: 'finance', label: 'Финансы', to: '/more/finance', icon: Wallet, subtitle: 'Траты и доходы' },
  {
    id: 'energy',
    label: 'Энергия',
    to: '/more/energy',
    icon: BatteryCharging,
    subtitle: 'Что меня восстанавливает',
  },
  {
    id: 'places',
    label: 'Места',
    to: '/more/places',
    icon: MapPin,
    subtitle: 'Советы, идеи, рекомендации',
  },
  { id: 'stats', label: 'Статистика', to: '/stats', icon: ChartColumnBig, subtitle: 'Обзор продуктивности' },
  {
    id: 'settings',
    label: 'Настройки',
    to: '/more/settings',
    icon: SettingsIcon,
    nonHideable: true,
    subtitle: 'Копии, синхронизация, оформление',
  },
  { id: 'more', label: 'Ещё', to: '/more', icon: LayoutGrid, end: true, anchor: true },
];

export const SECTION_BY_ID = new Map<string, Section>(SECTIONS.map((s) => [s.id, s]));

/** Сколько пользовательских разделов помещается в панель слева от «Ещё». */
export const MAX_BOTTOM = 4;

/** Раскладка по умолчанию: что стоит в панели (без «Ещё» — он добавляется как якорь). */
export const DEFAULT_BOTTOM: SectionId[] = ['today', 'tasks', 'notes', 'family'];

/** id «Ещё» — единственный жёсткий якорь панели (последний слот). */
export const ANCHOR_ID: SectionId = 'more';
