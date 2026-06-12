import { NavLink } from 'react-router';
import { Sun, ListChecks, Flame, Target, Menu } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

const tabs = [
  { to: '/', label: 'Сегодня', icon: Sun, end: true },
  { to: '/tasks', label: 'Задачи', icon: ListChecks, end: false },
  { to: '/habits', label: 'Привычки', icon: Flame, end: false },
  { to: '/goals', label: 'Цели', icon: Target, end: false },
  { to: '/more', label: 'Ещё', icon: Menu, end: false },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function TabBar() {
  const settings = useSettings();
  const backupStale =
    !settings.lastBackupAt ||
    Date.now() - new Date(settings.lastBackupAt).getTime() > WEEK_MS;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="flex">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <span className="relative">
              <Icon size={23} strokeWidth={2} />
              {label === 'Ещё' && backupStale && (
                <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-warning" />
              )}
            </span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
