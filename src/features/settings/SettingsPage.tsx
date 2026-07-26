import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { BellRing, ChevronRight, GraduationCap, PhoneCall, SlidersHorizontal, Trash2,
  Lightbulb,
} from 'lucide-react';
import { MESSAGE_SOUNDS, playMessageSound, type MessageSound } from '../../lib/sounds';
import { RINGTONES, previewRingtone, type RingtoneKind } from '../../lib/family/ringtone';
import { Screen } from '../../components/layout/Screen';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useToast } from '../../components/ui/toastContext';
import { useSettings, updateSettings } from '../../hooks/useSettings';
import { db } from '../../db/db';
import { alive, now } from '../../db/repo';
import { enablePush, isIOS, isStandalone, pushEnabled, pushSupported, rescheduleAll } from '../../lib/push';
import {
  exportBackup,
  backupFilename,
  validateBackup,
  previewBackup,
  importBackup,
  type BackupFile,
} from '../../db/backup';
import { pushAccountSnapshot, pullAccountSnapshot } from '../../lib/cloudBackup';
import { formatRu } from '../../lib/dates';
import { ensurePersistentStorage, formatBytes, type StorageState } from '../../lib/storage';
import { HINT_IDS, resetSessionHints } from '../../hooks/useHint';
import { usePersistentStorage } from './usePersistentStorage';
import { SyncSection } from './sync/SyncSection';
import { InstallLink } from './InstallLink';
import type { Settings } from '../../db/types';

const THEME_OPTIONS: { value: Settings['theme']; label: string }[] = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Системная' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-semibold text-muted">{title}</h2>
      {children}
    </section>
  );
}

/** Состояние локального хранилища. Показываем ровно тогда, когда есть что
 *  сказать: браузер отказал в постоянном хранении — значит данные могут быть
 *  стёрты системой, и копия становится не рекомендацией, а необходимостью. */
function StorageStatus() {
  const [state, setState] = useState<StorageState | null>(null);
  useEffect(() => {
    void ensurePersistentStorage().then(setState);
  }, []);

  if (!state || state.persisted === undefined) return null;
  const used = state.usage !== undefined ? formatBytes(state.usage) : null;

  return state.persisted ? (
    <p className="text-sm text-muted">
      Данные защищены от автоочистки браузером{used ? `, занято ${used}` : ''}.
    </p>
  ) : (
    <p className="text-sm leading-snug">
      <span className="font-semibold text-warning">Браузер не гарантирует сохранность данных.</span>{' '}
      <span className="text-muted">
        Если открывать приложение как обычную вкладку, Safari стирает данные сайта после недели без
        визитов. Установите приложение на экран «Домой» и держите копию{used ? ` (сейчас занято ${used})` : ''}.
      </span>
    </p>
  );
}

/** Возврат скрытых подсказок. Отдельной строкой от сброса обучения, с живым
 *  счётчиком: кнопка без обратной связи выглядит как сломанная — нажал, ничего
 *  видимого не случилось, а подсказка всплывёт когда-то потом на своём экране. */
function HintsResetRow() {
  const settings = useSettings();
  const hidden = settings.seenHints?.length ?? 0;
  const nothingToReset = hidden === 0;

  return (
    <button
      type="button"
      disabled={nothingToReset}
      onClick={() => {
        void updateSettings({ seenHints: [] });
        // И те, что скрыты «только сейчас», — иначе кнопка вернула бы часть
        // подсказок, а человек считает их одним набором.
        resetSessionHints();
      }}
      className="flex w-full items-center gap-2 border-b border-hairline p-4 text-left disabled:opacity-40"
    >
      <Lightbulb size={20} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">Показать подсказки заново</span>
        <span className="block text-sm text-muted">
          {nothingToReset ? 'Все подсказки на месте' : `Скрыто ${hidden} из ${HINT_IDS.length}`}
        </span>
      </span>
      <ChevronRight size={20} className="shrink-0 text-muted" />
    </button>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const { persisted, usageMb } = usePersistentStorage();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pushOn, setPushOn] = useState(pushEnabled());
  // Защита от повторного запуска async-операций при быстрых повторных кликах.
  const pushingRef = useRef(false);
  const exportingRef = useRef(false);
  const cloudRef = useRef(false);
  const syncCfg = useLiveQuery(() => db.sync.get('config'), []);
  const syncOn = Boolean(syncCfg?.enabled);

  async function handleEnablePush() {
    if (!pushSupported()) {
      alert('Уведомления не поддерживаются этим браузером.');
      return;
    }
    if (isIOS() && !isStandalone()) {
      alert(
        'На iPhone уведомления работают только в установленном приложении. Добавьте LifeHearth на экран «Домой» и откройте оттуда.',
      );
      return;
    }
    if (pushingRef.current) return;
    pushingRef.current = true;
    try {
      const res = await enablePush();
      if (!res.ok) {
        alert(
          res.reason === 'denied'
            ? 'Разрешение не выдано. Включите его: Настройки iPhone → Уведомления → LifeHearth.'
            : 'Не удалось включить уведомления.',
        );
        return;
      }
      setPushOn(true);
      const tasks = alive(await db.tasks.toArray()).filter((t) => !t.completedAt);
      await rescheduleAll(tasks);
      toast('Уведомления включены');
    } finally {
      pushingRef.current = false;
    }
  }

  async function handleExport() {
    if (exportingRef.current) return;
    exportingRef.current = true;
    try {
      const backup = await exportBackup();
      const json = JSON.stringify(backup, null, 2);
      const file = new File([json], backupFilename(), { type: 'application/json' });

      // share-шит — только на iOS (там это путь в «Файлы»); на десктопе
      // системный share-диалог блокирует страницу, качаем напрямую
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
        } catch (err) {
          // AbortError — пользователь закрыл шит шаринга, это не ошибка
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            alert('Не удалось поделиться файлом бэкапа');
          }
          return;
        }
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      await updateSettings({ lastBackupAt: now() });
      toast('Резервная копия сохранена');
    } finally {
      exportingRef.current = false;
    }
  }

  // Подтверждение + применение копии (файл или облако) — общая логика.
  async function confirmAndImport(backup: BackupFile): Promise<void> {
    const p = previewBackup(backup);
    const msg =
      'Импорт заменит ВСЕ текущие данные.\n\nВ резервной копии:\n' +
      `• проектов: ${p.counts.projects}\n` +
      `• задач: ${p.counts.tasks}\n` +
      `• целей: ${p.counts.goals}\n` +
      `• привычек: ${p.counts.habits}\n` +
      `• отметок привычек: ${p.counts.habitLogs}\n` +
      `• заметок: ${p.counts.notes}\n` +
      `• материалов обучения: ${p.counts.learningItems}\n` +
      `• записей прогресса: ${p.counts.learningLogs}\n` +
      `• расходов: ${p.counts.expenseItems}\n` +
      `• записей энергии: ${p.counts.energyItems}\n` +
      `• мест: ${p.counts.placeItems}\n` +
      `• метрик: ${p.counts.metrics}\n` +
      `• замеров метрик: ${p.counts.metricLogs}\n` +
      `• семейных сообщений: ${p.counts.familyMessages ?? 0}\n` +
      `• семейных задач: ${p.counts.familyTasks ?? 0}\n\nПродолжить?`;
    if (!window.confirm(msg)) return;
    await importBackup(backup);
    toast('Данные восстановлены');
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяет выбрать тот же файл повторно
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      await confirmAndImport(validateBackup(parsed));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось прочитать файл резервной копии');
    }
  }

  async function handleCloudBackupNow() {
    if (cloudRef.current) return;
    cloudRef.current = true;
    try {
      const n = await pushAccountSnapshot();
      if (!n) {
        alert('Сначала включите синхронизацию — облачная копия хранится под вашим ключом.');
        return;
      }
      await updateSettings({ lastCloudBackupAt: now() });
      toast('Копия сохранена в облако');
    } catch {
      alert('Не удалось сохранить копию в облако. Проверьте связь и попробуйте ещё раз.');
    } finally {
      cloudRef.current = false;
    }
  }

  async function handleCloudRestore() {
    if (cloudRef.current) return;
    cloudRef.current = true;
    try {
      const backup = await pullAccountSnapshot();
      if (!backup) {
        alert('В облаке пока нет резервной копии.');
        return;
      }
      await confirmAndImport(backup);
    } catch {
      alert('Не удалось получить копию из облака. Проверьте связь и попробуйте ещё раз.');
    } finally {
      cloudRef.current = false;
    }
  }

  return (
    <Screen title="Настройки" backTo="/home">
      <div className="space-y-6">
        <Section title="Тема">
          <div className="card p-4">
            <SegmentedControl
              options={THEME_OPTIONS}
              value={settings.theme}
              onChange={(theme) => void updateSettings({ theme })}
            />
          </div>
        </Section>

        <Section title="Уведомления">
          <div className="card">
            <div className="p-4">
              {pushOn ? (
                <p className="text-sm">
                  <span className="font-medium text-success">Включены</span> · напоминания о
                  задачах придут даже при закрытом приложении
                </p>
              ) : (
                <>
                  <Button className="w-full" onClick={() => void handleEnablePush()}>
                    Включить уведомления
                  </Button>
                  <p className="mt-2 text-sm text-muted">
                    Нужны для напоминаний о задачах («напомнить за 15 минут»). На iPhone работают
                    только в установленном приложении.
                  </p>
                </>
              )}
            </div>
            {/* Подписи строк ниже намеренно без truncate: обрезать их нельзя —
                из «Класс…» вместо «Классический» непонятно, какой звук выбран.
                Но и min-w-0 у подписи стоять не должно: с ним она сжималась ниже
                своего min-content, и слово «сообщений» (100px) вылезало из
                отведённых 67px прямо под непрозрачный чип селекта — 24.8px
                глифов оказывались под ним, а тап в конце строки попадал в select.
                Без min-w-0 подпись держит ширину слова, а перенести на вторую
                строку не помещающийся чип позволяет flex-wrap: на 320px иконка
                20 + подпись 100 + чип 115 + зазоры 17 = 252px против 250px
                доступных — чип уезжает на вторую строку целиком. На широких
                экранах ничего не меняется: всё влезает в одну строку, и flex-1
                подписи по-прежнему прижимает селект к правому краю. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
              <BellRing size={20} className="shrink-0 text-muted" />
              <span className="flex-1">Звук сообщений</span>
              {/* Выбор сразу проигрывает звук — слышно, что выбираешь. */}
              {/* compact-Select вместо голого <select>: он снимает системную
                  стрелку, съедавшую ~40px внутри поля, и берёт ширину по самому
                  длинному варианту. Прежние min-w-0 + max-w-[45%] были защитой от
                  выдавливания строки за пределы .card (overflow:hidden) — с чипом
                  по контенту (115px из 250px) выдавливать уже нечем. */}
              <Select
                compact
                value={settings.messageSound ?? 'tritone'}
                onChange={(e) => {
                  const v = e.target.value as MessageSound;
                  void updateSettings({ messageSound: v });
                  void playMessageSound(v);
                }}
              >
                {MESSAGE_SOUNDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
              <PhoneCall size={20} className="shrink-0 text-muted" />
              <span className="flex-1">Звук звонка</span>
              {/* Выбор сразу проигрывает короткий фрагмент рингтона. */}
              <Select
                compact
                value={settings.callSound ?? 'classic'}
                onChange={(e) => {
                  const v = e.target.value as RingtoneKind;
                  void updateSettings({ callSound: v });
                  previewRingtone(v);
                }}
              >
                {RINGTONES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Section>

        <Section title="Синхронизация">
          <SyncSection />
        </Section>

        <Section title="Данные">
          <div className="card space-y-3 p-4">
            {/* Автоматическая облачная копия — переживает потерю телефона */}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm font-medium">Автокопия в облако</span>
              {syncOn && (
                <div className="w-32 shrink-0">
                  <SegmentedControl<'off' | 'cloud'>
                    options={[
                      { value: 'off', label: 'Выкл' },
                      { value: 'cloud', label: 'Вкл' },
                    ]}
                    value={settings.autoBackup === 'cloud' ? 'cloud' : 'off'}
                    onChange={(v) => void updateSettings({ autoBackup: v })}
                  />
                </div>
              )}
            </div>
            {!syncOn ? (
              <p className="text-sm text-muted">
                Доступна при включённой синхронизации: зашифрованная копия всех данных хранится
                в облаке под вашим ключом и переживает потерю или замену телефона.
              </p>
            ) : settings.autoBackup === 'cloud' ? (
              <>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted">Как часто</span>
                  {/* Тот же дефект, что у звуков: под системную стрелку уходило
                      ~40px внутри поля, и «Каждую неделю» (105px) не помещалось в
                      оставшиеся 76px — читалось «Каждую не…». compact-Select даёт
                      ширину по контенту (125px), подпись рядом занимает 72px из
                      250px строки — на 320px влезает целиком, без переноса. */}
                  <Select
                    compact
                    className="font-medium"
                    value={settings.autoBackupEvery ?? 'daily'}
                    onChange={(e) =>
                      void updateSettings({
                        autoBackupEvery: e.target.value as 'daily' | 'weekly',
                      })
                    }
                  >
                    <option value="daily">Каждый день</option>
                    <option value="weekly">Каждую неделю</option>
                  </Select>
                </label>
                <p className="text-sm text-muted">
                  Облачная копия:{' '}
                  {settings.lastCloudBackupAt ? (
                    formatRu(settings.lastCloudBackupAt.slice(0, 10), 'd MMMM yyyy')
                  ) : (
                    <span className="font-bold text-warning">ещё не создана</span>
                  )}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => void handleCloudBackupNow()}
                  >
                    Сохранить сейчас
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => void handleCloudRestore()}
                  >
                    Восстановить
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                Зашифрованная копия всех данных будет сама сохраняться в облако.
              </p>
            )}
            <div className="h-px bg-hairline" />
            <StorageStatus />
            <div className="h-px bg-hairline" />
            <Button className="w-full" onClick={() => void handleExport()}>
              Экспортировать резервную копию
            </Button>
            {/* Прямо о том, что в файле. Копия в облако шифруется ключом на
                устройстве, а файл — обычный JSON: он читается любым, кто его
                откроет. Человек имеет право знать это ДО того, как отправит
                файл себе в мессенджер. */}
            <p className="text-sm leading-snug text-muted">
              В копию входит всё: задачи, заметки, финансы, семейный чат, а также раздел «Женские
              дни», если вы им пользуетесь. Файл не зашифрован — храните его там, куда нет доступа
              у посторонних. Копия в облако, в отличие от файла, шифруется на устройстве.
            </p>
            <p className="text-sm text-muted">
              Последняя копия:{' '}
              {settings.lastBackupAt ? (
                formatRu(settings.lastBackupAt.slice(0, 10), 'd MMMM yyyy')
              ) : (
                <span className="font-bold text-warning">никогда</span>
              )}
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              Импортировать резервную копию
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void handleImport(e)}
            />
          </div>
        </Section>

        <Section title="Хранилище">
          <div className="card space-y-1.5 p-4 text-sm">
            <p>
              Защищённое хранилище:{' '}
              <span className="font-medium">
                {persisted === null ? 'Неизвестно' : persisted ? 'Да' : 'Нет'}
              </span>
            </p>
            <p>
              Занято:{' '}
              <span className="font-medium">
                {usageMb === null ? 'неизвестно' : `${usageMb.toFixed(1).replace('.', ',')}\u00A0МБ`}
              </span>
            </p>
            {(persisted === false || settings.lastBackupAt === null) && (
              <p className="text-warning">Регулярно делайте резервную копию.</p>
            )}
          </div>
        </Section>

        <Section title="Приложение">
          <div className="card">
            <Link
              to="/more/settings/sections"
              className="flex items-center gap-2 border-b border-hairline p-4"
            >
              <SlidersHorizontal size={20} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">Настроить разделы</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </Link>
            <Link to="/more/trash" className="flex items-center gap-2 border-b border-hairline p-4">
              <Trash2 size={20} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">Корзина</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </Link>
            <button
              type="button"
              // Только тур. Подсказки возвращаются отдельной строкой ниже:
              // раньше одна кнопка делала два дела, и человек, которому нужен
              // был тур, заодно получал обратно все скрытые советы.
              onClick={() => void updateSettings({ onboardingDone: null })}
              className="flex w-full items-center gap-2 border-b border-hairline p-4 text-left"
            >
              <GraduationCap size={20} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">Показать обучение заново</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </button>
            <HintsResetRow />
            <Link
              to="/more/settings/install"
              className="flex items-center justify-between gap-2 border-b border-hairline p-4"
            >
              <span className="min-w-0">Установка и восстановление данных</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </Link>
            <div className="p-4">
              <p className="mb-2.5 text-sm text-muted">
                Ссылка для установки — открыть в Safari и добавить на «Домой», переустановить
                или поделиться приложением:
              </p>
              <InstallLink />
            </div>
            <p className="border-t border-hairline px-4 py-3 text-sm text-muted">
              Версия 1.0.0 · данные хранятся только на этом устройстве
            </p>
          </div>
        </Section>
      </div>
    </Screen>
  );
}
