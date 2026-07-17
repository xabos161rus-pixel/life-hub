import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  LayoutGrid,
  Lightbulb,
  ListTodo,
  NotebookText,
  Sparkles,
  Sun,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { db } from '../../db/db';
import { now } from '../../db/repo';
import { updateSettings } from '../../hooks/useSettings';

const SLIDES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Sparkles,
    title: 'Добро пожаловать в Life Hub',
    text: 'Личный центр управления жизнью: задачи, цели, заметки, финансы и семья. Все данные хранятся на вашем устройстве и работают офлайн.',
  },
  {
    icon: Sun,
    title: 'Сегодня',
    text: 'План на день: задачи с сегодняшним сроком, просроченные, напоминания и виджеты. Начинайте день с этого экрана.',
  },
  {
    icon: ListTodo,
    title: 'Задачи и проекты',
    text: 'Быстрый ввод одной строкой: «завтра в 10 позвонить маме» — дата и время распознаются сами. Свайп по задаче вправо — выполнить, влево — перенести или удалить, удержание — перетащить в другой проект.',
  },
  {
    icon: NotebookText,
    title: 'Заметки',
    text: 'Как в iOS: первая строка становится заголовком. Панель внизу — форматирование и списки, всё сохраняется автоматически.',
  },
  {
    icon: Target,
    title: 'Цели',
    text: 'Ставьте большие цели и отслеживайте прогресс: вручную, по привязанным задачам или по числовому показателю.',
  },
  {
    icon: LayoutGrid,
    title: 'Раздел «Ещё»',
    text: 'Семейный чат и звонки, финансы, фокус-таймер, обучение, места и энергия. Там же настройки, бэкап и синхронизация между устройствами.',
  },
  {
    icon: Lightbulb,
    title: 'Подсказки по ходу дела',
    text: 'Начните пользоваться — приложение само подскажет мелкие удобства в нужный момент: жесты, быстрый ввод, форматирование. Каждая подсказка закрывается крестиком и больше не повторяется.',
  },
];

/**
 * Вводный тур по разделам для нового пользователя. Показывается поверх всего
 * приложения, пока в настройках не проставлен onboardingDone (кнопки «Начать»
 * или «Пропустить»). Повторный показ — из Настроек («Показать обучение»).
 */
export function OnboardingOverlay() {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const [step, setStep] = useState(0);
  // Пока настройки не загрузились — не мигаем туром; пройден — не показываем.
  if (!settings || settings.onboardingDone) return null;

  const finish = () => {
    setStep(0); // повторный запуск из Настроек начнётся с первого слайда
    void updateSettings({ onboardingDone: now() });
  };

  const slide = SLIDES[step];
  const Icon = slide.icon;
  const last = step === SLIDES.length - 1;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-bg">
      <div aria-hidden className="aurora pointer-events-none absolute inset-0" />
      {/* key={step} перезапускает fade-in при смене слайда */}
      <div
        key={step}
        className="relative flex min-h-0 flex-1 animate-fade-in flex-col items-center justify-center gap-5 px-8 text-center"
      >
        <div className="flex size-20 items-center justify-center rounded-3xl bg-accent/15 text-accent shadow-[var(--shadow-accent)]">
          <Icon size={40} strokeWidth={1.5} />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{slide.title}</h2>
        <p className="max-w-sm text-[15px] leading-relaxed text-muted">{slide.text}</p>
      </div>

      <div className="relative flex items-center justify-center gap-1.5 pb-5">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Шаг ${i + 1}`}
            onClick={() => setStep(i)}
            className={`h-2 rounded-full transition-all ${
              i === step ? 'w-5 bg-accent' : 'w-2 bg-muted/40'
            }`}
          />
        ))}
      </div>

      <div className="relative flex items-center gap-3 px-6 pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <button
          type="button"
          onClick={finish}
          className="px-3 py-3 text-sm font-medium text-muted active:opacity-60"
        >
          Пропустить
        </button>
        <button
          type="button"
          onClick={last ? finish : () => setStep((s) => s + 1)}
          className="flex flex-1 items-center justify-center gap-1 rounded-2xl bg-accent px-5 py-3.5 font-semibold text-white shadow-[var(--shadow-accent)] active:opacity-80"
        >
          {last ? 'Начать' : 'Далее'}
          {!last && <ChevronRight size={18} />}
        </button>
      </div>
    </div>
  );
}
