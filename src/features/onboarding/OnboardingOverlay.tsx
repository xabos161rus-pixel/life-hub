import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  LayoutGrid,
  Lightbulb,
  ListTodo,
  NotebookText,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { db } from '../../db/db';
import { now } from '../../db/repo';
import { updateSettings } from '../../hooks/useSettings';
import { REINSTALL_NOTICE_VERSION } from '../../lib/appInstall';

const SLIDES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Sparkles,
    title: 'Добро пожаловать в LifeHearth',
    text: 'LifeHearth — тихий центр твоей жизни. Задачи, цели, заметки, деньги и семья — в одном спокойном месте, всегда под рукой и даже без интернета. Всё живёт на твоём устройстве и принадлежит только тебе.',
  },
  {
    icon: Sun,
    title: 'Сегодня',
    text: 'Начинай день с ясной головой. «Сегодня» мягко показывает только то, что важно сейчас — без давления длинных списков. Один взгляд — и понятно, куда двигаться.',
  },
  {
    icon: ListTodo,
    title: 'Задачи без давления',
    text: 'Задачи — не про «надо», а про свободу не держать всё в голове. Записал — и отпустил: приложение напомнит вовремя, а ты живёшь, а не сверяешься со списком.',
  },
  {
    icon: NotebookText,
    title: 'Заметки',
    text: 'Место для мыслей и идей, которые жалко потерять. Просто начни писать — первая строка станет заголовком. Твой второй мозг, всегда под рукой.',
  },
  {
    icon: Target,
    title: 'Цели',
    text: 'Мечты становятся ближе, когда виден прогресс. Накопить, пробежать, выучить — поставь цель и наблюдай, как шаг за шагом к ней приближаешься.',
  },
  {
    icon: LayoutGrid,
    title: 'Всё под тебя',
    text: 'Остальные грани жизни: семья и общий чат, финансы и накопления, привычки, здоровье, места. Оставь нужное, спрячь лишнее — приложение подстраивается под тебя, а не наоборот.',
  },
  {
    icon: ShieldCheck,
    title: 'Только твоё',
    text: 'Твоя жизнь — только твоя. Включи синхронизацию: всё будет на твоих устройствах под твоим ключом, а зашифрованная копия переживёт даже потерю телефона. И напоминания придут, даже когда приложение закрыто.',
  },
  {
    icon: Lightbulb,
    title: 'Рядом, когда нужно',
    text: 'Ничего не нужно заучивать. LifeHearth — как добрый советник: подскажет удобные мелочи тогда, когда пригодятся — жесты, быстрый ввод, даже что кнопку «+» можно перетащить под себя. А дальше просто живи — остальное рядом.',
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
    // reinstallNoticeSeen проставляем сразу текущей версией: тот, кто ставит
    // приложение сейчас, уже получил актуальный значок — окно о переустановке
    // ему не нужно.
    void updateSettings({ onboardingDone: now(), reinstallNoticeSeen: REINSTALL_NOTICE_VERSION });
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
