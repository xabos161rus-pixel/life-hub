import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Screen } from '../../components/layout/Screen';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useToast } from '../../components/ui/Toast';
import { useSettings, updateSettings } from '../../hooks/useSettings';
import { now } from '../../db/repo';
import {
  exportBackup,
  backupFilename,
  validateBackup,
  previewBackup,
  importBackup,
} from '../../db/backup';
import { formatRu } from '../../lib/dates';
import { usePersistentStorage } from './usePersistentStorage';
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

  async function handleExport() {
    const backup = await exportBackup();
    const json = JSON.stringify(backup, null, 2);
    const file = new File([json], backupFilename(), { type: 'application/json' });

    if (navigator.canShare?.({ files: [file] })) {
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
    toast('Бэкап сохранён');
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяет выбрать тот же файл повторно
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const backup = validateBackup(parsed);
      const p = previewBackup(backup);
      const msg =
        'Импорт заменит ВСЕ текущие данные.\n\nВ бэкапе:\n' +
        `• проектов: ${p.counts.projects}\n` +
        `• задач: ${p.counts.tasks}\n` +
        `• целей: ${p.counts.goals}\n` +
        `• привычек: ${p.counts.habits}\n` +
        `• отметок привычек: ${p.counts.habitLogs}\n` +
        `• заметок: ${p.counts.notes}\n` +
        `• материалов обучения: ${p.counts.learningItems}\n` +
        `• записей прогресса: ${p.counts.learningLogs}\n\nПродолжить?`;
      if (!window.confirm(msg)) return;
      await importBackup(backup);
      toast('Данные восстановлены');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось прочитать файл бэкапа');
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

        <Section title="Данные">
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <Button className="w-full" onClick={() => void handleExport()}>
              Экспортировать бэкап
            </Button>
            <p className="text-sm text-muted">
              Последний бэкап:{' '}
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
              Импортировать бэкап
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
            {persisted === false && (
              <p className="text-warning">Регулярно делайте бэкап.</p>
            )}
          </div>
        </Section>

        <Section title="Приложение">
          <div className="rounded-2xl border border-border bg-surface">
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
