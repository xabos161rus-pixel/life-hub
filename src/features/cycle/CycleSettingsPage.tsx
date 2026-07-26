import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check } from 'lucide-react';
import { Screen } from '../../components/layout/Screen';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { hashPin } from '../../lib/crypto';
import { lockCycleSection } from './lockState';
import { db } from '../../db/db';
import type { CycleSettings } from '../../db/cycleTypes';
import { DEFAULT_CYCLE_SETTINGS, updateCycleSettings } from '../../lib/cycle/cycleRepo';
import { AUTO_TASK_TEMPLATES, MAX_ACTIVE_AUTO_TASKS } from '../../lib/cycle/autoTasks';

/** Переключатель строкой. Своя реализация вместо нативного checkbox: нужен
 *  крупный тач-таргет на всю строку и подпись под заголовком, а нативный
 *  input этого не даёт без обёрток, которые всё равно пришлось бы писать. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 py-3.5 text-left disabled:opacity-40"
    >
      {/* Пол ширины подписи: без него длинный заголовок ужимает саму галочку. */}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-sm leading-snug text-muted">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
          checked ? 'border-accent bg-accent-fill text-white' : 'border-border bg-surface-2'
        }`}
      >
        {checked && <Check size={15} strokeWidth={3} />}
      </span>
    </button>
  );
}

/** Код доступа к разделу. Отдельным блоком, потому что это единственное место
 *  в приложении, где что-то закрывается кодом, и правила тут свои. */
function PinSection({ settings }: { settings: CycleSettings }) {
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const has = settings.lock === 'pin' && settings.pin !== undefined;

  async function save() {
    if (pin.length < 4 || pin !== repeat || busy) return;
    setBusy(true);
    try {
      await updateCycleSettings({ lock: 'pin', pin: await hashPin(pin) });
      setPin('');
      setRepeat('');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Убрать код? Раздел будет открываться без него.')) return;
    await updateCycleSettings({ lock: 'none', pin: undefined });
    lockCycleSection();
  }

  return (
    <section>
      <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Код доступа</h2>
      <div className="card space-y-3 p-4">
        {has ? (
          <>
            <p className="text-sm text-muted">
              Раздел закрыт кодом. Он спрашивается при каждом открытии приложения.
            </p>
            <Button variant="secondary" className="w-full" onClick={() => void remove()}>
              Убрать код
            </Button>
          </>
        ) : (
          <>
            {/* Столбик, а не два поля в ряд: на 320px пара полей по 4-8 цифр
                ужимается до нечитаемого, а поля кода набирают вслепую. */}
            <Field label="Код (4–8 цифр)">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
            </Field>
            <Field label="Ещё раз">
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value.replace(/\D/g, '').slice(0, 8))}
              />
            </Field>
            {repeat.length > 0 && pin !== repeat && (
              <p className="text-sm text-danger">Коды не совпадают</p>
            )}
            <Button
              className="w-full"
              disabled={pin.length < 4 || pin !== repeat || busy}
              onClick={() => void save()}
            >
              Установить код
            </Button>
          </>
        )}
        {/* Прямо о границах защиты. Обещать больше, чем код даёт, — хуже, чем
            не иметь кода: человек станет полагаться на то, чего нет. */}
        <p className="text-xs leading-snug text-muted">
          Код закрывает раздел от посторонних глаз, но не шифрует записи: тот, кто разбирается в
          устройстве телефона, сможет их прочитать в обход. Шифровать данные кодом мы не стали
          сознательно — забытый код означал бы потерю всей истории, а восстановить её неоткуда.
          Сам код нигде не хранится, сверяется только его отпечаток.
        </p>
      </div>
    </section>
  );
}

export function CycleSettingsPage() {
  const row = useLiveQuery(() => db.cycleSettings.get('app'), []);
  const s: CycleSettings = row ?? { ...DEFAULT_CYCLE_SETTINGS, updatedAt: '' };

  const setIntegration = (key: keyof CycleSettings['integrations'], value: boolean) =>
    void updateCycleSettings({ integrations: { ...s.integrations, [key]: value } });

  return (
    <Screen title="Настройки раздела" backTo="/more/cycle">
      <div className="space-y-5">
        <section>
          <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Прогноз</h2>
          <div className="card divide-y divide-hairline px-4">
            <ToggleRow
              label="Показывать прогноз"
              hint="Когда выключено, раздел ведёт только календарь — без оценок и диапазонов."
              checked={s.predictionsEnabled}
              onChange={(v) => void updateCycleSettings({ predictionsEnabled: v })}
            />
            <ToggleRow
              label="Фертильные дни"
              hint="Оценка окна зачатия. По календарю она приблизительная — интервал около двух недель, поэтому для предохранения не годится."
              checked={s.fertilityDisplay !== 'off'}
              onChange={(v) =>
                void updateCycleSettings({ fertilityDisplay: v ? 'probability_map' : 'off' })
              }
            />
          </div>
        </section>

        <section>
          <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Связь с приложением</h2>
          <div className="card divide-y divide-hairline px-4">
            <ToggleRow
              label="Задачи по циклу"
              hint={`Приложение само поставит «${AUTO_TASK_TEMPLATES.supplies.title}» перед ожидаемой менструацией и напомнит о плановом визите к врачу. Не больше ${MAX_ACTIVE_AUTO_TASKS} задач одновременно.`}
              checked={s.integrations.autoTasks}
              onChange={(v) => setIntegration('autoTasks', v)}
            />
            <ToggleRow
              label="Строка на экране «Сегодня»"
              hint="День цикла и, если включён прогноз, ожидаемые даты."
              checked={s.integrations.todayCard}
              onChange={(v) => setIntegration('todayCard', v)}
            />
            <ToggleRow
              label="Отметки в календаре"
              hint="Дни менструации и диапазон прогноза в общем календаре приложения."
              checked={s.integrations.calendarMarks}
              onChange={(v) => setIntegration('calendarMarks', v)}
            />
            <ToggleRow
              label="Сравнение с энергией"
              hint="Показывает, как отметки энергии распределяются по дням цикла. Только ваши числа, без выводов и советов."
              checked={s.integrations.energyCorrelation}
              onChange={(v) => setIntegration('energyCorrelation', v)}
            />
          </div>
          {/* Прямая оговорка про то, чего раздел делать не будет. Стоит рядом с
              переключателями, а не в справке: именно здесь человек решает,
              сколько приложению позволено. */}
          <p className="mt-2 px-1 text-xs leading-snug text-muted">
            Приложение не будет подстраивать за вас план дня, тренировки или задачи под фазу
            цикла. Влияние фазы на работоспособность в исследованиях оказалось незначительным, а
            советы вроде «сегодня не берись за сложное» вредят больше, чем помогают.
          </p>
        </section>

        <section>
          <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Формулировки</h2>
          <div className="card divide-y divide-hairline px-4">
            <ToggleRow
              label="Нейтральные названия"
              hint={`Задачи и уведомления называются обтекаемо: «${AUTO_TASK_TEMPLATES.supplies.title}» вместо «${AUTO_TASK_TEMPLATES.supplies.directTitle}». Список задач видно с чужого плеча чаще, чем сам раздел.`}
              checked={s.neutralNotificationText}
              onChange={(v) => void updateCycleSettings({ neutralNotificationText: v })}
            />
          </div>
        </section>

        <PinSection settings={s} />

        <section>
          <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Данные</h2>
          <div className="card divide-y divide-hairline px-4">
            <ToggleRow
              label="Синхронизация между устройствами"
              hint="Пока недоступна. Записи раздела не уходят на сервер и не передаются между устройствами."
              checked={s.syncEnabled}
              onChange={() => undefined}
              disabled
            />
            <ToggleRow
              label="Включать в резервную копию"
              hint="Раздел не синхронизируется, поэтому копия — единственное, что спасёт историю при потере телефона. Если выключить, записи в копию не попадут и восстановить их будет неоткуда."
              checked={s.includeInGeneralBackup}
              onChange={(v) => void updateCycleSettings({ includeInGeneralBackup: v })}
            />
          </div>
        </section>
      </div>
    </Screen>
  );
}
