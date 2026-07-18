import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router';
import { BellRing, ChevronRight, GraduationCap, PhoneCall, Trash2 } from 'lucide-react';
import { MESSAGE_SOUNDS, playMessageSound, type MessageSound } from '../../lib/sounds';
import { RINGTONES, previewRingtone, type RingtoneKind } from '../../lib/family/ringtone';
import { Screen } from '../../components/layout/Screen';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useToast } from '../../components/ui/Toast';
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
import { usePersistentStorage } from './usePersistentStorage';
import { SyncSection } from './sync/SyncSection';
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
        'На iPhone уведомления работают только в установленном приложении. Добавьте Life Hub на экран «Домой» и откройте оттуда.',
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
            ? 'Разрешение не выдано. Включите его: Настройки iPhone → Уведомления → Life Hub.'
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
    <Screen title="Настройки" backTo="/more">
      <div className="space-y-6">
        <Section title="Тема">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <SegmentedControl
              options={THEME_OPTIONS}
              value={settings.theme}
              onChange={(theme) => void updateSettings({ theme })}
            />
          </div>
        </Section>

        <Section title="Уведомления">
          <div className="rounded-2xl border border-border bg-surface">
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
                    Нужны для напоминаний о задачах («напомнить за N мин»). На iPhone работают
                    только в установленном приложении.
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-border p-4">
              <BellRing size={20} className="shrink-0 text-muted" />
              <span className="flex-1">Звук сообщений</span>
              {/* Выбор сразу проигрывает звук — слышно, что выбираешь. */}
              <select
                value={settings.messageSound ?? 'tritone'}
                onChange={(e) => {
                  const v = e.target.value as MessageSound;
                  void updateSettings({ messageSound: v });
                  void playMessageSound(v);
                }}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none"
              >
                {MESSAGE_SOUNDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 border-t border-border p-4">
              <PhoneCall size={20} className="shrink-0 text-muted" />
              <span className="flex-1">Звук звонка</span>
              {/* Выбор сразу проигрывает короткий фрагмент рингтона. */}
              <select
                value={settings.callSound ?? 'classic'}
                onChange={(e) => {
                  const v = e.target.value as RingtoneKind;
                  void updateSettings({ callSound: v });
                  previewRingtone(v);
                }}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-text outline-none"
              >
                {RINGTONES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>

        <Section title="Синхронизация">
          <SyncSection />
        </Section>

        <Section title="Данные">
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            {/* Автоматическая облачная копия — переживает потерю телефона */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Авто-копия в облако</span>
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
                  <span className="text-muted">Как часто</span>
                  <select
                    value={settings.autoBackupEvery ?? 'daily'}
                    onChange={(e) =>
                      void updateSettings({
                        autoBackupEvery: e.target.value as 'daily' | 'weekly',
                      })
                    }
                    className="rounded-lg bg-surface-2 px-2.5 py-1.5 font-medium"
                  >
                    <option value="daily">Каждый день</option>
                    <option value="weekly">Каждую неделю</option>
                  </select>
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
            <Button className="w-full" onClick={() => void handleExport()}>
              Экспортировать резервную копию
            </Button>
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
          <div className="space-y-1.5 rounded-2xl border border-border bg-surface p-4 text-sm">
            <p>
              Защищённое хранилище:{' '}
              <span className="font-medium">
                {persisted === null ? 'Неизвестно' : persisted ? 'Да' : 'Нет'}
              </span>
            </p>
            <p>
              Занято:{' '}
              <span className="font-medium">
                {usageMb === null ? 'неизвестно' : `${usageMb.toFixed(1).replace('.', ',')} МБ`}
              </span>
            </p>
            {(persisted === false || settings.lastBackupAt === null) && (
              <p className="text-warning">Регулярно делайте резервную копию.</p>
            )}
          </div>
        </Section>

        <Section title="Приложение">
          <div className="rounded-2xl border border-border bg-surface">
            <Link to="/more/trash" className="flex items-center gap-2 border-b border-border p-4">
              <Trash2 size={20} className="shrink-0 text-muted" />
              <span className="flex-1">Корзина</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </Link>
            <button
              type="button"
              // Сброс тура и всех контекстных подсказок: тур откроется сразу,
              // подсказки снова всплывут по разделам.
              onClick={() => void updateSettings({ onboardingDone: null, seenHints: [] })}
              className="flex w-full items-center gap-2 border-b border-border p-4 text-left"
            >
              <GraduationCap size={20} className="shrink-0 text-muted" />
              <span className="flex-1">Показать обучение заново</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </button>
            <Link
              to="/more/settings/install"
              className="flex items-center justify-between gap-2 p-4"
            >
              <span>Как установить на экран «Домой»</span>
              <ChevronRight size={20} className="shrink-0 text-muted" />
            </Link>
            <p className="border-t border-border px-4 py-3 text-sm text-muted">
              Версия 1.0.0 · данные хранятся только на этом устройстве
            </p>
          </div>
        </Section>
      </div>
    </Screen>
  );
}
