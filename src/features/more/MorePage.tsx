import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, GraduationCap, Settings as SettingsIcon, StickyNote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Screen } from '../../components/layout/Screen';
import { db } from '../../db/db';
import { alive } from '../../db/repo';

const BACKUP_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

interface MenuCardProps {
  to: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  subtitleWarning?: boolean;
  badge?: boolean;
}

function MenuCard({ to, icon: Icon, title, subtitle, subtitleWarning, badge }: MenuCardProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 active:opacity-80"
    >
      <div className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
        <Icon size={22} />
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {subtitle && (
          <p className={`text-sm ${subtitleWarning ? 'text-warning' : 'text-muted'}`}>
            {subtitle}
          </p>
        )}
      </div>
      <ChevronRight size={20} className="shrink-0 text-muted" />
    </Link>
  );
}

export function MorePage() {
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const learning = useLiveQuery(
    () => db.learningItems.where('status').equals('inProgress').toArray(),
    [],
  );
  // Date.now() внутри querier, а не в рендере: вычисляется заново при
  // каждом изменении settings (после бэкапа бейдж гаснет сразу).
  const backupDue =
    useLiveQuery(async () => {
      const s = await db.settings.get('app');
      return (
        !s?.lastBackupAt ||
        Date.now() - new Date(s.lastBackupAt).getTime() > BACKUP_STALE_MS
      );
    }, []) ?? false;

  const notesCount = alive(notes ?? []).length;
  const learningCount = alive(learning ?? []).length;

  return (
    <Screen title="Ещё">
      <div className="space-y-3">
        <MenuCard
          to="/more/notes"
          icon={StickyNote}
          title="Заметки"
          subtitle={`${notesCount} ${pluralRu(notesCount, 'заметка', 'заметки', 'заметок')}`}
        />
        <MenuCard
          to="/more/learning"
          icon={GraduationCap}
          title="Обучение"
          subtitle={`${learningCount} в процессе`}
        />
        <MenuCard
          to="/more/settings"
          icon={SettingsIcon}
          title="Настройки"
          subtitle={backupDue ? 'Пора сделать бэкап' : undefined}
          subtitleWarning={backupDue}
          badge={backupDue}
        />
      </div>
    </Screen>
  );
}
