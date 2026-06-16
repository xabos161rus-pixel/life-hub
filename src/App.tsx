import { Component, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { InstallBanner } from './components/layout/InstallBanner';
import { ReloadPrompt } from './components/layout/ReloadPrompt';
import { TabBar } from './components/layout/TabBar';
import { ToastProvider } from './components/ui/Toast';
import { useSettings } from './hooks/useSettings';
import { TodayPage } from './features/today/TodayPage';
import { TasksPage } from './features/tasks/TasksPage';
import { GoalsPage } from './features/goals/GoalsPage';
import { GoalDetailPage } from './features/goals/GoalDetailPage';
import { MorePage } from './features/more/MorePage';
import { NotesPage } from './features/notes/NotesPage';
import { NoteEditorPage } from './features/notes/NoteEditorPage';
import { LearningPage } from './features/learning/LearningPage';
import { FinancePage } from './features/finance/FinancePage';
import { EnergyPage } from './features/energy/EnergyPage';
import { PlacesPage } from './features/places/PlacesPage';
import { SearchPage } from './features/search/SearchPage';
import { StatsPage } from './features/stats/StatsPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { TrashPage } from './features/trash/TrashPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { InstallInstructionsPage } from './features/settings/InstallInstructionsPage';

function ThemeApplier() {
  const { theme } = useSettings();
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const light = theme === 'light' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('light', light);
    };
    apply();
    if (theme === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);
  return null;
}

/** Ловит throw при рендере любой страницы — вместо белого экрана показывает
 *  fallback с кнопкой перезагрузки. Данные в IndexedDB при этом целы. */
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-lg font-semibold">Что-то пошло не так</p>
          <p className="text-sm text-muted">
            Перезагрузите приложение — данные сохранены на устройстве.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-accent px-5 py-3 font-semibold text-white active:opacity-80"
          >
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** ВРЕМЕННЫЙ диагностический блок — измеряет реальную геометрию вьюпорта на
 *  устройстве (в dev-инструментах вырез айфона не виден). Убрать после замера. */
function DebugInfo() {
  const [t, setT] = useState('measuring…');
  useEffect(() => {
    const id = setTimeout(() => {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      const saT = cs.paddingTop;
      const saB = cs.paddingBottom;
      probe.remove();
      const nav = document.querySelector('nav');
      const r = nav?.getBoundingClientRect();
      const ih = window.innerHeight;
      const sb = document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute('content');
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      setT(
        [
          'BUILD diag-1',
          `innerH ${ih}  screenH ${window.screen.height}`,
          `visualVP ${Math.round(window.visualViewport?.height ?? 0)}`,
          `docClientH ${document.documentElement.clientHeight}`,
          `safeArea  top ${saT}  bot ${saB}`,
          `navBottom ${r ? Math.round(r.bottom) : 'n/a'}  navTop ${r ? Math.round(r.top) : 'n/a'}`,
          `GAP innerH-navBottom = ${r ? ih - Math.round(r.bottom) : 'n/a'}`,
          `statusBar ${sb}`,
          `standalone ${standalone}`,
        ].join('\n'),
      );
    }, 350);
    return () => clearTimeout(id);
  }, []);
  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        top: '40%',
        zIndex: 200,
        background: 'rgba(18,18,28,0.96)',
        border: '1px solid #6366f1',
        color: '#fff',
        font: '12px/1.6 ui-monospace, monospace',
        padding: '12px 14px',
        borderRadius: 10,
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none',
      }}
    >
      {t}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <ThemeApplier />
        <ErrorBoundary>
          {/* Каркас прибит ко ВСЕМ четырём краям (inset-0) — гарантированно
              покрывает весь экран в standalone-PWA, без полосы-пустоты внизу
              (h-dvh с top-0 на iPhone до низа не доставал). Скроллится только
              контент; таб-бар — обычный flex-элемент в самом низу. bg-bg
              заливает весь каркас, включая safe-area под таб-баром. */}
          <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg">
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <Routes>
                <Route path="/" element={<TodayPage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/more/trash" element={<TrashPage />} />
                <Route path="/notes" element={<NotesPage />} />
                <Route path="/notes/:id" element={<NoteEditorPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/goals/:id" element={<GoalDetailPage />} />
                <Route path="/more" element={<MorePage />} />
                <Route path="/more/learning" element={<LearningPage />} />
                <Route path="/more/finance" element={<FinancePage />} />
                <Route path="/more/energy" element={<EnergyPage />} />
                <Route path="/more/places" element={<PlacesPage />} />
                <Route path="/more/settings" element={<SettingsPage />} />
                <Route path="/more/settings/install" element={<InstallInstructionsPage />} />
              </Routes>
            </div>
            <InstallBanner />
            <ReloadPrompt />
            <TabBar />
            <DebugInfo />
          </div>
        </ErrorBoundary>
      </ToastProvider>
    </BrowserRouter>
  );
}
