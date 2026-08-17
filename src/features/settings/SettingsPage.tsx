import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { BellRing, Bot, GraduationCap, PhoneCall, SlidersHorizontal, Lightbulb } from 'lucide-react';
import {
  GCheck,
  GChevronRight as ChevronRight,
  GTrash as Trash2,
} from '../../components/ui/glyphs';
import { ACCENTS } from '../../lib/accents';
import { getLang, resolveLang, t } from '../../lib/i18n';
import { APP_VERSION } from '../../lib/changelog';
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
import {
  BackupWouldLoseDataError,
  cloudBackupDate,
  pushAccountSnapshot,
  pullAccountSnapshot,
} from '../../lib/cloudBackup';
import { formatRu } from '../../lib/dates';
import { ensurePersistentStorage, formatBytes, type StorageState } from '../../lib/storage';
import { HINT_IDS, resetSessionHints } from '../../hooks/useHint';
import { usePersistentStorage } from './usePersistentStorage';
import { SyncSection } from './sync/SyncSection';
import { InstallLink } from './InstallLink';
import type { Settings } from '../../db/types';

/** Имена таблиц человеческим языком — они уходят в диалог о перезаписи копии,
 *  и «cycleDays: 214 → 0» там читалось бы как сообщение об ошибке. */
const TABLE_RU: Record<string, string> = {
  cycleDays: 'дни цикла',
  cycleOverrides: 'правки цикла',
  cycleEpisodes: 'эпизоды цикла',
  cycleSettings: 'настройки цикла',
  cycleSymptoms: 'симптомы',
  cyclePredictions: 'прогнозы цикла',
  familyMessages: 'сообщения в семье',
  familyTasks: 'семейные задачи',
  familyMembers: 'участники семьи',
};


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
      {t('Данные защищены от автоочистки браузером{suffix}.', {
        suffix: used ? t(', занято {used}', { used }) : '',
      })}
    </p>
  ) : (
    <p className="text-sm leading-snug">
      <span className="font-semibold text-warning">
        {t('Браузер не гарантирует сохранность данных.')}
      </span>{' '}
      <span className="text-muted">
        {t(
          'Если открывать приложение как обычную вкладку, Safari стирает данные сайта после недели без визитов. Установите приложение на экран «Домой» и держите копию{suffix}.',
          { suffix: used ? t(' (сейчас занято {used})', { used }) : '' },
        )}
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
        <span className="block truncate">{t('Показать подсказки заново')}</span>
        <span className="block text-sm text-muted">
          {nothingToReset
            ? t('Все подсказки на месте')
            : t('Скрыто {hidden} из {total}', { hidden, total: HINT_IDS.length })}
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
  // undefined — ещё спрашиваем сервер, null — копии нет, строка — дата.
  const [cloudDate, setCloudDate] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!syncOn) return;
    let live = true;
    void cloudBackupDate().then((d) => {
      if (live) setCloudDate(d);
    });
    return () => {
      live = false;
    };
  }, [syncOn]);

  async function handleEnablePush() {
    if (!pushSupported()) {
      toast(t('Уведомления не поддерживаются этим браузером.'));
      return;
    }
    if (isIOS() && !isStandalone()) {
      toast(
        t(
          'На iPhone уведомления работают только в установленном приложении. Добавьте LifeHearth на экран «Домой» и откройте оттуда.',
        ),
      );
      return;
    }
    if (pushingRef.current) return;
    pushingRef.current = true;
    try {
      const res = await enablePush();
      if (!res.ok) {
        toast(
          res.reason === 'denied'
            ? t('Разрешение не выдано. Включите его: Настройки iPhone → Уведомления → LifeHearth.')
            : t('Не удалось включить уведомления.'),
        );
        return;
      }
      setPushOn(true);
      const tasks = alive(await db.tasks.toArray()).filter((task) => !task.completedAt);
      await rescheduleAll(tasks);
      toast(t('Уведомления включены'));
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
            toast(t('Не удалось поделиться файлом резервной копии. Он сохранён — найдите его в «Файлах»'));
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
      toast(t('Резервная копия сохранена'));
    } finally {
      exportingRef.current = false;
    }
  }

  // Подтверждение + применение копии (файл или облако) — общая логика.
  async function confirmAndImport(backup: BackupFile): Promise<void> {
    const p = previewBackup(backup);
    const msg = t(
      'Импорт заменит ВСЕ текущие данные.\n\nВ резервной копии:\n• проектов: {projects}\n• задач: {tasks}\n• целей: {goals}\n• привычек: {habits}\n• отметок привычек: {habitLogs}\n• заметок: {notes}\n• материалов обучения: {learningItems}\n• записей прогресса: {learningLogs}\n• расходов: {expenseItems}\n• способов восстановления: {energyItems}\n• отметок энергии: {energyLogs}\n• мест: {placeItems}\n• метрик: {metrics}\n• замеров метрик: {metricLogs}\n• семейных сообщений: {familyMessages}\n• семейных задач: {familyTasks}\n\nПродолжить?',
      {
        projects: p.counts.projects,
        tasks: p.counts.tasks,
        goals: p.counts.goals,
        habits: p.counts.habits,
        habitLogs: p.counts.habitLogs,
        notes: p.counts.notes,
        learningItems: p.counts.learningItems,
        learningLogs: p.counts.learningLogs,
        expenseItems: p.counts.expenseItems,
        energyItems: p.counts.energyItems,
        energyLogs: p.counts.energyLogs ?? 0,
        placeItems: p.counts.placeItems,
        metrics: p.counts.metrics,
        metricLogs: p.counts.metricLogs,
        familyMessages: p.counts.familyMessages ?? 0,
        familyTasks: p.counts.familyTasks ?? 0,
      },
    );
    if (!window.confirm(msg)) return;
    await importBackup(backup);
    toast(t('Данные восстановлены'));
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяет выбрать тот же файл повторно
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      await confirmAndImport(validateBackup(parsed));
    } catch (err) {
      toast(err instanceof Error ? err.message : t('Не удалось прочитать файл резервной копии'));
    }
  }

  async function handleCloudBackupNow(force = false) {
    if (cloudRef.current) return;
    cloudRef.current = true;
    try {
      const n = await pushAccountSnapshot(force);
      if (!n) {
        toast(t('Сначала включите синхронизацию — облачная копия хранится под вашим ключом.'));
        return;
      }
      await updateSettings({ lastCloudBackupAt: now(), cloudBackupBlocked: null });
      setCloudDate(new Date().toISOString());
      toast(t('Копия сохранена в облако'));
    } catch (e) {
      // Копия в облаке полнее, чем данные здесь. Хранение latest-only: запись
      // сотрёт её без следа, а история цикла и старая переписка не приедут
      // обратно ниоткуда — дельта-синк их не возит. Поэтому не «не удалось»,
      // а прямой вопрос с числами: сколько записей исчезнет.
      if (e instanceof BackupWouldLoseDataError) {
        const lines = e.losing.map((l) =>
          t('{table}: {had} → {now}', { table: t(TABLE_RU[l.table] ?? l.table), had: l.had, now: l.now }),
        );
        const when = e.remoteDate
          ? t(' от {date}', { date: formatRu(e.remoteDate.slice(0, 10), 'd MMMM yyyy') })
          : '';
        const ok = window.confirm(
          t(
            'В облаке лежит копия{when}, и в ней БОЛЬШЕ данных, чем на этом устройстве:\n\n{lines}\n\nЗаменить её копией с этого устройства? Разницу вернуть будет неоткуда.',
            { when, lines: lines.join('\n') },
          ),
        );
        if (ok) await handleCloudBackupNow(true);
        return;
      }
      toast(t('Не удалось сохранить копию в облако. Проверьте связь и попробуйте ещё раз.'));
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
        toast(t('В облаке пока нет резервной копии.'));
        return;
      }
      await confirmAndImport(backup);
    } catch {
      toast(t('Не удалось получить копию из облака. Проверьте связь и попробуйте ещё раз.'));
    } finally {
      cloudRef.current = false;
    }
  }

  return (
    <Screen title={t('Настройки')} backTo="/home">
      <div className="space-y-6">
        <Section title={t('Оформление')}>
          <div className="card">
            <div className="p-4">
              <SegmentedControl
                options={THEME_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                value={settings.theme}
                onChange={(theme) => void updateSettings({ theme })}
              />
            </div>
            {/* Акцент применяется мгновенно — сам экран и есть превью. Кружки
                показывают палитру каждого акцента (акцент, пара, заливка) в
                цветах текущей темы: превью в чужой теме обещало бы не те
                цвета, что человек получит. */}
            {ACCENTS.map((a) => {
              const selected = (settings.accent ?? 'indigo') === a.id;
              const light =
                settings.theme === 'light' ||
                (settings.theme === 'system' &&
                  window.matchMedia('(prefers-color-scheme: light)').matches);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => void updateSettings({ accent: a.id })}
                  aria-pressed={selected}
                  className="flex w-full items-center gap-3 border-t border-hairline p-4 text-left active:opacity-80"
                >
                  <span className="flex shrink-0 -space-x-1.5">
                    {(light ? a.light : a.dark).map((c, i) => (
                      <span
                        key={i}
                        className="size-5 rounded-full ring-2 ring-surface"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{t(a.label)}</span>
                    <span className="block text-sm text-muted">{t(a.hint)}</span>
                  </span>
                  {selected && <GCheck size={18} className="shrink-0 text-accent" />}
                </button>
              );
            })}
            {/* Смена языка перерисовывает приложение перезагрузкой: строки
                читаются в момент рендера, reload — честный способ обновить
                каждую (язык меняют раз в жизни, цена приемлема). */}
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
              <span className="flex-1">{t('Язык')}</span>
              <Select
                compact
                aria-label={t('Язык')}
                value={settings.language ?? 'system'}
                onChange={(e) => {
                  const v = e.target.value;
                  const language = v === 'system' ? undefined : (v as 'ru' | 'en');
                  void updateSettings({ language }).then(() => {
                    if (resolveLang(language) !== getLang()) window.location.reload();
                  });
                }}
              >
                <option value="system">{t('Как в системе')}</option>
                <option value="ru">{t('Русский')}</option>
                <option value="en">English</option>
              </Select>
            </div>
          </div>
        </Section>

        <Section title={t('Уведомления')}>
          <div className="card">
            <div className="p-4">
              {pushOn ? (
                <p className="text-sm">
                  <span className="font-medium text-success">{t('Включены')}</span>{' · '}
                  {t('напоминания о задачах придут даже при закрытом приложении')}
                </p>
              ) : (
                <>
                  <Button className="w-full" onClick={() => void handleEnablePush()}>
                    {t('Включить уведомления')}
                  </Button>
                  <p className="mt-2 text-sm text-muted">
                    {t(
                      'Нужны для напоминаний о задачах («напомнить за 15 минут»). На iPhone работают только в установленном приложении.',
                    )}
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
              <span className="flex-1">{t('Звук сообщений')}</span>
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
                    {t(s.label)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline p-4">
              <PhoneCall size={20} className="shrink-0 text-muted" />
              <span className="flex-1">{t('Звук звонка')}</span>
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
                    {t(r.label)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Section>

        <Section title={t('Синхронизация')}>
          <SyncSection />
        </Section>

        <Section title={t('Данные')}>
          <div className="card space-y-3 p-4">
            {/* Автоматическая облачная копия — переживает потерю телефона */}
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm font-medium">{t('Копия в облаке')}</span>
              {syncOn && (
                <div className="w-32 shrink-0">
                  <SegmentedControl<'off' | 'cloud'>
                    options={[
                      { value: 'off', label: t('Выкл') },
                      { value: 'cloud', label: t('Вкл') },
                    ]}
                    value={settings.autoBackup === 'cloud' ? 'cloud' : 'off'}
                    onChange={(v) => void updateSettings({ autoBackup: v })}
                  />
                </div>
              )}
            </div>
            {!syncOn ? (
              <p className="text-sm text-muted">
                {t(
                  'Доступна при включённой синхронизации: зашифрованная копия всех данных хранится в облаке под вашим ключом и переживает потерю или замену телефона.',
                )}
              </p>
            ) : settings.autoBackup === 'cloud' ? (
              <>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted">{t('Как часто')}</span>
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
                    <option value="daily">{t('Каждый день')}</option>
                    <option value="weekly">{t('Каждую неделю')}</option>
                  </Select>
                </label>
                {/* Дата — С СЕРВЕРА, а не из settings. Локальная отметка между
                    устройствами не синхронизируется, и на втором телефоне тут
                    всегда горело «ещё не создана» — ровно тот текст, который
                    толкает нажать «Сохранить сейчас» и затереть единственную
                    полную копию снапшотом пустого устройства. Пока ответ не
                    пришёл, не пишем ничего: «не создана» на секунду — то же
                    самое ложное сообщение, только мельком. */}
                <p className="text-sm text-muted">
                  {t('Копия в облаке:')}{' '}
                  {cloudDate === undefined ? (
                    <span className="opacity-60">{t('проверяем…')}</span>
                  ) : cloudDate ? (
                    formatRu(cloudDate.slice(0, 10), 'd MMMM yyyy')
                  ) : (
                    <span className="font-bold text-warning">{t('ещё не создана')}</span>
                  )}
                </p>
                {settings.cloudBackupBlocked && (
                  <p className="text-sm text-warning">
                    {t(
                      'Автокопия приостановлена: в облаке лежит копия полнее, чем данные на этом устройстве. Нажмите «Сохранить сейчас», чтобы решить, что с этим делать.',
                    )}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => void handleCloudBackupNow()}
                  >
                    {t('Сохранить сейчас')}
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => void handleCloudRestore()}
                  >
                    {t('Восстановить')}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                {t('Зашифрованная копия всех данных будет сама сохраняться в облако.')}
              </p>
            )}
            <div className="h-px bg-hairline" />
            <StorageStatus />
            <div className="h-px bg-hairline" />
            <Button className="w-full" onClick={() => void handleExport()}>
              {t('Экспортировать резервную копию')}
            </Button>
            {/* Прямо о том, что в файле. Копия в облако шифруется ключом на
                устройстве, а файл — обычный JSON: он читается любым, кто его
                откроет. Человек имеет право знать это ДО того, как отправит
                файл себе в мессенджер. */}
            <p className="text-sm leading-snug text-muted">
              {t(
                'В копию входит всё: задачи, заметки, финансы, семейный чат, а также раздел «Женские дни», если вы им пользуетесь. Файл не зашифрован — храните его там, куда нет доступа у посторонних. Копия в облако, в отличие от файла, шифруется на устройстве.',
              )}
            </p>
            <p className="text-sm text-muted">
              {t('Последняя резервная копия:')}{' '}
              {settings.lastBackupAt ? (
                formatRu(settings.lastBackupAt.slice(0, 10), 'd MMMM yyyy')
              ) : (
                <span className="font-bold text-warning">{t('никогда')}</span>
              )}
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              {t('Импортировать резервную копию')}
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

        <Section title={t('Хранилище')}>
          <div className="card space-y-1.5 p-4 text-sm">
            <p>
              {t('Защищённое хранилище:')}{' '}
              <span className="font-medium">
                {/* «Нет» — омоним ключа приоритета задач (None); здесь ответ
                    «да/нет» — явная ветка языка. */}
                {persisted === null
                  ? t('Неизвестно')
                  : persisted
                    ? t('Да')
                    : getLang() === 'en'
                      ? 'No'
                      : 'Нет'}
              </span>
            </p>
            <p>
              {t('Занято:')}{' '}
              <span className="font-medium">
                {usageMb === null
                  ? t('неизвестно')
                  : t('{n}\u00A0МБ', {
                      n: getLang() === 'en' ? usageMb.toFixed(1) : usageMb.toFixed(1).replace('.', ','),
                    })}
              </span>
            </p>
            {(persisted === false || settings.lastBackupAt === null) && (
              <p className="text-warning">{t('Регулярно делайте резервную копию.')}</p>
            )}
          </div>
        </Section>

        <Section title={t('Приложение')}>
          <div className="card">
            <Link
              to="/more/settings/sections"
              className="flex items-center gap-2 border-b border-hairline p-4"
            >
              <SlidersHorizontal size={20} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{t('Настроить разделы')}</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </Link>
            {/* Раздел ИИ за флагом: пока фича дописывается, её можно мержить в
                main рабочего приложения, не показывая на «Главной». */}
            <div className="border-b border-hairline p-4">
              <div className="mb-2.5 flex items-center gap-2">
                <Bot size={20} className="shrink-0 text-muted" />
                <span className="flex-1">
                  {t('Раздел «ИИ»')}
                  <span className="block text-sm text-muted">
                    {t('Чат с языковой моделью. Нужна включённая синхронизация — ею идёт авторизация.')}
                  </span>
                </span>
              </div>
              <SegmentedControl<'off' | 'on'>
                options={[
                  { value: 'off', label: t('Скрыт') },
                  { value: 'on', label: t('Показать') },
                ]}
                value={settings.aiEnabled ? 'on' : 'off'}
                onChange={(v) => void updateSettings({ aiEnabled: v === 'on' })}
              />
            </div>
            <Link to="/more/trash" className="flex items-center gap-2 border-b border-hairline p-4">
              <Trash2 size={20} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{t('Корзина')}</span>
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
              <span className="min-w-0 flex-1 truncate">{t('Показать обучение заново')}</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </button>
            <HintsResetRow />
            <Link
              to="/more/settings/install"
              className="flex items-center justify-between gap-2 border-b border-hairline p-4"
            >
              <span className="min-w-0">{t('Установка и восстановление данных')}</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </Link>
            <div className="p-4">
              <p className="mb-2.5 text-sm text-muted">
                {t(
                  'Ссылка для установки — открыть в Safari и добавить на «Домой», переустановить или поделиться приложением:',
                )}
              </p>
              <InstallLink />
            </div>
            {/* Версия — из changelog, а не хардкод: прежняя строка «1.0.0»
                застыла навсегда и врала. Тап открывает окно «Что нового»
                (сброс lastSeenVersion — WhatsNew сам покажется). */}
            <button
              type="button"
              onClick={() => void updateSettings({ lastSeenVersion: '' })}
              className="flex w-full items-center gap-2 border-t border-hairline px-4 py-3 text-left"
            >
              <span className="min-w-0 flex-1 text-sm text-muted">
                {t('Версия {v} · данные хранятся только на этом устройстве', { v: APP_VERSION })}
              </span>
              <span className="shrink-0 text-sm font-medium text-accent">{t('Что нового')}</span>
            </button>
          </div>
        </Section>
      </div>
    </Screen>
  );
}
