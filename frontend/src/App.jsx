import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { SocketProvider } from './lib/socket.jsx';
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
import { EpicDetailPage, EpicsPage } from './pages/Epics.tsx';
import { TeamDetailPage, TeamsPage } from './pages/Teams.tsx';
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
  const { user, loading, role, sessionError, retry } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="size-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#2563EB]" />
      </div>
    );
  }

  // The API was unreachable (cold start, offline). Keep the user here instead of
  // dropping them on the login screen as if their session had ended.
  if (!user && sessionError) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-slate-600">
            Could not reach the server. Your session is still saved.
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            className="rounded-md bg-[#2563EB] px-3 py-1.5 text-sm text-white"
          >
            Try again
          </button>
        </div>
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
        <Route path="epics" element={<EpicsPage />} />
        <Route path="epics/:id" element={<EpicDetailPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:id" element={<TeamDetailPage />} />
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
            <SocketProvider>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/*" element={<ProtectedRoutes />} />
              </Routes>
            </SocketProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
