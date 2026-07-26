import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, Cloud, CloudOff, Settings as SettingsIcon, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Screen } from '../../components/layout/Screen';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { useNavLayout } from '../../hooks/useNavLayout';
import { formatRu } from '../../lib/dates';
import { SECTION_BY_ID } from '../../lib/sections';

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
      className="flex items-center gap-3 card p-4 active:opacity-80"
    >
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
        <Icon size={20} />
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-warning" />
        )}
      </div>
      {/* min-w-0 обязателен: иначе длинная подпись не даёт колонке сжаться и
          выдавливает стрелку за край карточки. */}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {/* Две строки вместо многоточия: на 320px под подпись остаётся 158px,
            а «Общие задачи, чат и звонки» требует 299 — обрезка съедала
            половину фразы. Карточка от второй строки подрастает, но список
            всё равно вертикальный, и читаемость важнее ровной высоты. */}
        {subtitle && (
          <p
            className={`line-clamp-2 text-sm leading-snug ${
              subtitleWarning ? 'text-warning' : 'text-muted'
            }`}
          >
            {subtitle}
          </p>
        )}
      </div>
      <ChevronRight size={20} className="shrink-0 text-muted" />
    </Link>
  );
}

/** Карточка профиля. Ведёт на экран редактирования; пока ничего не заполнено —
 *  зовёт заполнить, а не показывает пустые поля. */
function ProfileCard() {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const p = settings?.profile;
  const hasAny = Boolean(p?.name || p?.avatar || p?.heightCm || p?.weightKg);

  const facts = [
    p?.heightCm ? `${p.heightCm}\u00A0см` : null,
    p?.weightKg ? `${String(p.weightKg).replace('.', ',')}\u00A0кг` : null,
    p?.birthDate ? formatRu(p.birthDate, 'd MMMM yyyy') : null,
  ].filter(Boolean);

  return (
    <Link
      to="/home/profile"
      className="flex items-center gap-3.5 card p-4 active:opacity-80"
    >
      {p?.avatar ? (
        <img
          src={p.avatar}
          alt=""
          className="size-14 shrink-0 rounded-full object-cover"
          width={56}
          height={56}
        />
      ) : (
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
          <User size={24} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-lg font-semibold ${p?.name?.trim() ? 'truncate' : 'leading-tight'}`}>
          {p?.name?.trim() || (hasAny ? 'Без имени' : 'Заполнить профиль')}
        </p>
        <p className="text-sm leading-snug text-muted">
          {facts.length > 0 ? facts.join(' · ') : 'Имя, фото, рост и вес'}
        </p>
      </div>
      <ChevronRight size={20} className="shrink-0 text-muted" />
    </Link>
  );
}

/** Состояние данных: синхронизация и свежесть копии.
 *
 *  Стоит на «Главной», а не в настройках, по одной причине: это единственное
 *  место, где человек узнаёт, что его данные под угрозой, не заходя специально
 *  в настройки. Потеря данных — самая частая претензия к приложениям этой
 *  категории, и она почти всегда следует из того, что человек не знал. */
function DataStatusCard() {
  const syncCfg = useLiveQuery(() => db.sync.get('config').then((c) => c ?? null), []);
  // Date.now() внутри запроса, а не в рендере: рендер обязан быть чистым, а
  // здесь значение к тому же пересчитывается при каждом изменении настроек —
  // значит после копии предупреждение гаснет сразу.
  const status = useLiveQuery(async () => {
    const s = await db.settings.get('app');
    const last = s?.lastBackupAt ?? null;
    return {
      last,
      stale: !last || Date.now() - new Date(last).getTime() > BACKUP_STALE_MS,
    };
  }, []);
  if (syncCfg === undefined || status === undefined) return null;

  const syncOn = Boolean(syncCfg?.enabled);
  const { last, stale } = status;

  return (
    <Link
      to="/more/settings"
      className="flex items-center gap-3 card p-4 active:opacity-80"
    >
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
          syncOn ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
        }`}
      >
        {syncOn ? <Cloud size={20} /> : <CloudOff size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{syncOn ? 'Данные синхронизируются' : 'Только на этом устройстве'}</p>
        {/* Без truncate по той же причине, что и в MenuCard: «Копию ещё не
            делали» на 320px не влезает в 158px и обрывалось на «не дел…» —
            ровно то предупреждение, которое обязано читаться целиком. */}
        <p className={`text-sm leading-snug ${stale ? 'text-warning' : 'text-muted'}`}>
          {last ? `Копия: ${formatRu(last.slice(0, 10), 'd MMMM')}` : 'Резервную копию ещё не делали'}
        </p>
      </div>
      <ChevronRight size={20} className="shrink-0 text-muted" />
    </Link>
  );
}

export function HomePage() {
  // Список разделов и их порядок — из раскладки «под себя»: то, что вынесено в
  // нижнюю панель или спрятано, здесь не повторяется.
  const { more } = useNavLayout();
  const learning = useLiveQuery(
    () => db.learningItems.where('status').equals('inProgress').toArray(),
    [],
  );
  // Date.now() внутри запроса, а не в рендере: пересчитывается при изменении
  // настроек, поэтому бейдж гаснет сразу после копии.
  const backupDue =
    useLiveQuery(async () => {
      const s = await db.settings.get('app');
      return !s?.lastBackupAt || Date.now() - new Date(s.lastBackupAt).getTime() > BACKUP_STALE_MS;
    }, []) ?? false;

  const learningCount = alive(learning ?? []).length;
  // Настройки показываем отдельной карточкой внизу, поэтому из общего списка
  // убираем — иначе они встретятся дважды.
  const sections = more.filter((s) => s.id !== 'settings');
  const settingsSection = SECTION_BY_ID.get('settings');

  return (
    <Screen title="Главная">
      <div className="space-y-5">
        <div className="space-y-3">
          <ProfileCard />
          <DataStatusCard />
        </div>

        {sections.length > 0 && (
          <section>
            <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Разделы</h2>
            <div className="space-y-3">
              {sections.map((s) => (
                <MenuCard
                  key={s.id}
                  to={s.to}
                  icon={s.icon}
                  title={s.label}
                  subtitle={s.id === 'learning' ? `${learningCount} в процессе` : s.subtitle}
                />
              ))}
            </div>
          </section>
        )}

        {settingsSection && (
          <section>
            <MenuCard
              to={settingsSection.to}
              icon={SettingsIcon}
              title={settingsSection.label}
              subtitle={backupDue ? 'Пора сделать резервную копию' : settingsSection.subtitle}
              subtitleWarning={backupDue}
              badge={backupDue}
            />
          </section>
        )}
      </div>
    </Screen>
  );
}
