import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronRight,
  GraduationCap,
  Wallet,
  BatteryCharging,
  MapPin,
  ChartColumnBig,
  Timer,
  Users,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Screen } from '../../components/layout/Screen';
import { db } from '../../db/db';
import { alive } from '../../db/repo';

const BACKUP_STALE_MS = 7 * 24 * 60 * 60 * 1000;

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

  // Есть ли непрочитанные сообщения хоть в одной семейной группе.
  const familyUnread =
    useLiveQuery(async () => {
      const cfgs = await db.family.toArray();
      if (!cfgs.length) return false;
      const byId = Object.fromEntries(cfgs.map((c) => [c.familyId, c]));
      const msgs = await db.familyMessages.toArray();
      return msgs.some((m) => {
        const c = byId[m.familyId];
        return c && !m.deletedAt && m.seq != null && m.seq > c.lastReadSeq && m.senderMemberId !== c.selfMemberId;
      });
    }, []) ?? false;

  const learningCount = alive(learning ?? []).length;

  return (
    <Screen title="Ещё">
      <div className="space-y-3">
        <MenuCard
          to="/stats"
          icon={ChartColumnBig}
          title="Статистика"
          subtitle="Обзор продуктивности"
        />
        <MenuCard to="/more/focus" icon={Timer} title="Фокус" subtitle="Таймер помодоро" />
        <MenuCard to="/more/family" icon={Users} title="Семья" subtitle="Общий чат и задачи" badge={familyUnread} />
        <MenuCard
          to="/more/learning"
          icon={GraduationCap}
          title="Обучение"
          subtitle={`${learningCount} в процессе`}
        />
        <MenuCard to="/more/finance" icon={Wallet} title="Финансы" subtitle="Траты и доходы" />
        <MenuCard
          to="/more/energy"
          icon={BatteryCharging}
          title="Энергия"
          subtitle="Что меня восстанавливает"
        />
        <MenuCard
          to="/more/places"
          icon={MapPin}
          title="Места и путешествия"
          subtitle="Советы, идеи, рекомендации"
        />
        <MenuCard
          to="/more/settings"
          icon={SettingsIcon}
          title="Настройки"
          subtitle={backupDue ? 'Пора сделать резервную копию' : undefined}
          subtitleWarning={backupDue}
          badge={backupDue}
        />
      </div>
    </Screen>
  );
}
