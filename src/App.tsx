import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { InstallBanner } from './components/layout/InstallBanner';
import { TabBar } from './components/layout/TabBar';
import { ToastProvider } from './components/ui/Toast';
import { useSettings } from './hooks/useSettings';
import { TodayPage } from './features/today/TodayPage';
import { TasksPage } from './features/tasks/TasksPage';
import { HabitsPage } from './features/habits/HabitsPage';
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

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <ThemeApplier />
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/habits" element={<HabitsPage />} />
          <Route path="/goals" element={<GoalsPage />} />
          <Route path="/goals/:id" element={<GoalDetailPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/more/notes" element={<NotesPage />} />
          <Route path="/more/notes/:id" element={<NoteEditorPage />} />
          <Route path="/more/learning" element={<LearningPage />} />
          <Route path="/more/settings" element={<SettingsPage />} />
          <Route path="/more/settings/install" element={<InstallInstructionsPage />} />
        </Routes>
        <InstallBanner />
        <TabBar />
      </ToastProvider>
    </BrowserRouter>
  );
}
