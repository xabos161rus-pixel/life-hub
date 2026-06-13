import { NavLink, useLocation } from 'react-router';
import { Sun, ListChecks, StickyNote, Target, Menu } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

const tabs = [
  { to: '/', label: 'Сегодня', icon: Sun, end: true },
  { to: '/tasks', label: 'Задачи', icon: ListChecks, end: false },
  { to: '/notes', label: 'Заметки', icon: StickyNote, end: false },
  { to: '/goals', label: 'Цели', icon: Target, end: false },
  { to: '/more', label: 'Ещё', icon: Menu, end: false },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function TabBar() {
  const settings = useSettings();
  const { pathname } = useLocation();
  const backupStale =
    !settings.lastBackupAt ||
    Date.now() - new Date(settings.lastBackupAt).getTime() > WEEK_MS;

  // На экране редактора заметки таб-бар скрыт — внизу панель форматирования.
  if (/^\/notes\/.+/.test(pathname)) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-elevated/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg px-1">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5"
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ${
                    isActive ? 'bg-accent/15 text-accent' : 'text-muted'
                  }`}
                >
                  <span className="relative">
                    <Icon size={22} strokeWidth={isActive ? 2.4 : 1.9} />
                    {label === 'Ещё' && backupStale && (
                      <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-warning ring-2 ring-elevated" />
                    )}
                  </span>
                </span>
                <span
                  className={`text-[11px] font-medium transition-colors ${
                    isActive ? 'text-accent' : 'text-muted'
                  }`}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
