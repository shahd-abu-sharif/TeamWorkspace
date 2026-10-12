import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ThemeProvider } from './lib/theme.jsx';
import { AppLayout } from './components/AppLayout.jsx';
import { LoginPage } from './pages/Login.jsx';
import { AcceptInvitePage } from './pages/AcceptInvite.jsx';
import { DashboardPage } from './pages/Dashboard.jsx';
import { KanbanPage } from './pages/Kanban.jsx';
import { TimelinePage } from './pages/Timeline.jsx';
import { NotificationsPage } from './pages/Notifications.jsx';
import { TasksPage } from './pages/Tasks.jsx';
import { TaskDetailPage } from './pages/TaskDetail.jsx';
import { SettingsPage } from './pages/Settings.tsx';
import { ImportWizard } from './pages/ImportWizard.tsx';
import { CalendarPage } from './pages/Calendar.tsx';
import { TeamPage } from './pages/Team.tsx';
import { ReportsPage } from './pages/Reports.tsx';
import { ChatPage } from './pages/Chat.tsx';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordRecovery.tsx';
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => {
        if (error?.status === 401 || error?.status === 403 || error?.status === 404) return false;
        return count < 2;
      },
    },
  },
});

function ProtectedRoutes() {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="size-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="my-tasks" element={<TasksPage mine />} />
        <Route path="tasks" element={role === 'LEADER' ? <TasksPage /> : <Navigate to="/my-tasks" replace />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="board" element={<KanbanPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="team" element={role === 'LEADER' ? <TeamPage /> : <Navigate to="/" replace />} />
        <Route path="import" element={role === 'LEADER' ? <ImportWizard /> : <Navigate to="/" replace />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="reports" element={role === 'LEADER' ? <ReportsPage /> : <Navigate to="/" replace />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/accept-invite" element={<AcceptInvitePage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/*" element={<ProtectedRoutes />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
