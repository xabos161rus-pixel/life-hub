import {
  CircleCheck,
  Compass,
  Share,
  Smartphone,
  SquarePlus,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Screen } from '../../components/layout/Screen';

const STEPS: { icon: LucideIcon; text: string }[] = [
  { icon: Compass, text: 'Откройте этот сайт в Safari' },
  { icon: Share, text: 'Нажмите «Поделиться»' },
  { icon: SquarePlus, text: 'Выберите «На экран „Домой“»' },
  { icon: Smartphone, text: 'Откройте Life Hub с экрана «Домой»' },
];

export function InstallInstructionsPage() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  return (
    <Screen title="Установка" backTo="/more/settings">
      {standalone ? (
        <div className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-4 text-success">
          <CircleCheck size={24} className="shrink-0" />
          <p className="font-semibold">Приложение установлено ✓</p>
        </div>
      ) : (
        <div className="space-y-3">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-bold text-accent">
                {i + 1}
              </span>
              <step.icon size={22} className="shrink-0 text-accent" />
              <p className="min-w-0">{step.text}</p>
            </div>
          ))}

          <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <TriangleAlert size={22} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-sm">
              Данные Safari и установленного приложения хранятся раздельно. Сначала
              установите приложение, и только потом вводите данные — иначе они
              останутся во вкладке Safari. Перенести уже введённые данные можно через
              Настройки → Экспорт/Импорт резервной копии.
            </p>
          </div>
        </div>
      )}
    </Screen>
  );
}
