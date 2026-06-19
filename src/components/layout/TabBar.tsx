import { NavLink, useLocation } from 'react-router';
import { Sun, ListTodo, NotebookText, Target, LayoutGrid } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

const tabs = [
  { to: '/', label: 'Сегодня', icon: Sun, end: true },
  { to: '/tasks', label: 'Задачи', icon: ListTodo, end: false },
  { to: '/notes', label: 'Заметки', icon: NotebookText, end: false },
  { to: '/goals', label: 'Цели', icon: Target, end: false },
  { to: '/more', label: 'Ещё', icon: LayoutGrid, end: false },
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
    <nav className="z-30 shrink-0 border-t border-hairline bg-elevated pb-[clamp(6px,env(safe-area-inset-bottom),8px)]">
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
                  className={`flex h-9 w-16 items-center justify-center rounded-2xl transition-colors duration-200 ${
                    isActive
                      ? 'bg-accent/15 text-accent shadow-[0_5px_18px_-7px_var(--app-accent)]'
                      : 'text-muted'
                  }`}
                >
                  <span className="relative">
                    <Icon
                      size={22}
                      // strokeWidth через inline style (перебивает глобальное
                      // правило .lucide): активный таб «наливается» весом 2.5.
                      style={{
                        strokeWidth: isActive ? 2.5 : 1.75,
                        ...(isActive
                          ? { filter: 'drop-shadow(0 0 6px var(--app-accent))' }
                          : {}),
                      }}
                    />
                    {label === 'Ещё' && backupStale && (
                      <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-warning ring-2 ring-elevated" />
                    )}
                  </span>
                </span>
                <span
                  className={`text-[11px] font-semibold transition-colors ${
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
