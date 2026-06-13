import { Component, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { InstallBanner } from './components/layout/InstallBanner';
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

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <ThemeApplier />
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/notes/:id" element={<NoteEditorPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/goals/:id" element={<GoalDetailPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/more/learning" element={<LearningPage />} />
            <Route path="/more/settings" element={<SettingsPage />} />
            <Route path="/more/settings/install" element={<InstallInstructionsPage />} />
          </Routes>
          <InstallBanner />
          <TabBar />
        </ErrorBoundary>
      </ToastProvider>
    </BrowserRouter>
  );
}
