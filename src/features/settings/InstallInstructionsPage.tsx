import type { ReactNode } from 'react';
import {
  CircleCheck,
  Compass,
  Download,
  KeyRound,
  RefreshCw,
  Share,
  ShieldCheck,
  Smartphone,
  SquarePlus,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { Screen } from '../../components/layout/Screen';
import { InstallLink } from './InstallLink';

const STEPS: { icon: LucideIcon; text: string }[] = [
  { icon: Compass, text: 'Откройте этот сайт в Safari' },
  { icon: Share, text: 'Нажмите «Поделиться»' },
  { icon: SquarePlus, text: 'Выберите «На экран „Домой“»' },
  { icon: Smartphone, text: 'Откройте LifeHearth с экрана «Домой»' },
];

/** Одна карточка «шаг» с иконкой и текстом. */
function Row({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-surface p-4">
      <Icon size={22} className="mt-0.5 shrink-0 text-accent" />
      <p className="min-w-0 text-sm leading-relaxed">{children}</p>
    </div>
  );
}

export function InstallInstructionsPage() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  return (
    <Screen title="Установка и данные" backTo="/more/settings">
      <div className="space-y-6">
        {/* --- Ссылка для установки (всегда доступна) --- */}
        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold text-muted">Ссылка для установки</h2>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="mb-3 text-sm leading-relaxed text-muted">
              Открывайте её в Safari, чтобы установить или переустановить приложение, или
              поделитесь ссылкой. Она всегда есть и в «Настройках».
            </p>
            <InstallLink />
          </div>
        </section>

        {/* --- Установка на экран «Домой» --- */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted">Установка на экран «Домой»</h2>
          {standalone ? (
            <div className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/10 p-4 text-success">
              <CircleCheck size={24} className="shrink-0" />
              <p className="font-semibold">Приложение установлено ✓</p>
            </div>
          ) : (
            <>
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
                <p className="text-sm leading-relaxed">
                  Данные Safari и установленного приложения хранятся раздельно. Сначала
                  установите приложение, и только потом вводите данные — иначе они останутся во
                  вкладке Safari. Перенести уже введённые данные можно через «Экспорт/Импорт
                  резервной копии» ниже.
                </p>
              </div>
            </>
          )}
        </section>

        {/* --- Данные: сохранить перед удалением и вернуть после --- */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted">Данные: сохранить и вернуть</h2>

          <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
            <TriangleAlert size={22} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-sm leading-relaxed">
              <span className="font-semibold">Перед удалением или переустановкой сохраните
              копию.</span>{' '}
              Приложение хранит задачи, заметки, цели и финансы на самом устройстве. Если удалить
              значок, iOS может стереть эти данные. Сохранённая копия возвращает всё обратно —
              ровно с той же точки.
            </p>
          </div>

          <p className="text-sm font-medium text-muted">Как сохранить (любой из способов):</p>

          <Row icon={Download}>
            <span className="font-semibold">Резервная копия в файл.</span> «Настройки → Данные →
            Экспортировать резервную копию». Файл сохранится в «Файлы» (или iCloud Drive) и
            переживёт удаление приложения.
          </Row>
          <Row icon={ShieldCheck}>
            <span className="font-semibold">Синхронизация (облако).</span> «Настройки →
            Синхронизация → Включить». Зашифрованная копия ложится в облако под вашим ключом. Если
            у вас одно устройство — сохраните ключ: «Показать QR → Сохранить ключ», иначе после
            удаления восстановить облако будет нечем.
          </Row>

          <p className="text-sm font-medium text-muted">Как вернуть после переустановки:</p>

          <Row icon={Upload}>
            <span className="font-semibold">Из файла.</span> Откройте приложение → «Настройки →
            Данные → Импортировать резервную копию» → выберите сохранённый файл.
          </Row>
          <Row icon={KeyRound}>
            <span className="font-semibold">Из синхронизации.</span> «Настройки → Синхронизация →
            Подключить к другому устройству» → отсканируйте QR со второго устройства или вставьте
            сохранённый ключ.
          </Row>
          <Row icon={RefreshCw}>
            После восстановления данные снова на месте, а если оставить синхронизацию включённой —
            новые изменения будут сами уходить в облако.
          </Row>
        </section>
      </div>
    </Screen>
  );
}
