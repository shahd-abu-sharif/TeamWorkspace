import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Bell, Calendar, ChartBar, ChevronDown, ChevronRight, Clock, FileText,
  LayoutDashboard, ListChecks, Menu, MessageCircle, Plus, Search, Settings,
  SlidersHorizontal, Users,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../lib/auth.jsx';
import { apiClient } from '../lib/api.js';
import { playNotificationSound, primeNotificationSound } from '../lib/notificationSound.js';
import { syncPushSubscription } from '../lib/push.js';
import { QuickCreateTask } from './QuickCreateTask.jsx';
import { LanguageSwitcher } from './LanguageSwitcher.jsx';

const NAV_MAIN = [
  { to: '/', labelKey: 'dashboard', icon: LayoutDashboard },
  { to: '/my-tasks', labelKey: 'myTasks', icon: ListChecks },
  { to: '/tasks', labelKey: 'allTasks', icon: SlidersHorizontal, leaderOnly: true },
  { to: '/board', labelKey: 'board', icon: LayoutDashboard },
  { to: '/timeline', labelKey: 'timeline', icon: Clock },
  { to: '/calendar', labelKey: 'calendar', icon: Calendar },
  { to: '/chat', labelKey: 'chat', icon: MessageCircle },
];

const NAV_ADMIN = [
  { to: '/team', labelKey: 'team', icon: Users, leaderOnly: true },
  { to: '/reports', labelKey: 'reports', icon: ChartBar, leaderOnly: true },
  { to: '/import', labelKey: 'import', icon: FileText, leaderOnly: true },
];

export function AppLayout() {
  const { t } = useTranslation();
  const { user, role, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user?.id) return undefined;
    const prefix = `tth_presence_${user.id}_`;
    const tabId = sessionStorage.getItem('tth_presence_tab') ||
      (window.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`);
    sessionStorage.setItem('tth_presence_tab', tabId);
    const ownKey = `${prefix}${tabId}`;
    const heartbeat = () => {
      localStorage.setItem(ownKey, String(Date.now()));
      void apiClient.post('/members/presence', {}).catch(() => {});
    };
    const endPresence = () => {
      localStorage.removeItem(ownKey);
      const now = Date.now();
      let anotherTabIsActive = false;
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const seenAt = Number(localStorage.getItem(key));
        if (now - seenAt < 90_000) anotherTabIsActive = true;
        else localStorage.removeItem(key);
      }
      if (!anotherTabIsActive) {
        void apiClient.post('/members/presence/offline', {}, { keepalive: true }).catch(() => {});
      }
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 20_000);
    document.addEventListener('visibilitychange', heartbeat);
    window.addEventListener('pagehide', endPresence);
    window.addEventListener('pageshow', heartbeat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', heartbeat);
      window.removeEventListener('pagehide', endPresence);
      window.removeEventListener('pageshow', heartbeat);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void syncPushSubscription().catch((error) => {
      console.error('Could not sync the browser push subscription:', error);
    });
  }, [user?.id]);

  useEffect(() => {
    const activate = () => primeNotificationSound();
    window.addEventListener('pointerdown', activate, { once: true });
    window.addEventListener('keydown', activate, { once: true });
    return () => {
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
    };
  }, []);

  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => apiClient.get('/notifications/unread-count'),
    refetchInterval: 10_000,
  });

  const { data: recentNotifications } = useQuery({
    queryKey: ['desktop-notifications', user?.id],
    queryFn: () => apiClient.get('/notifications?page=1&pageSize=8&unread=true'),
    enabled: Boolean(user?.id),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (!user?.id || !recentNotifications?.items) return;
    const key = `tth_seen_notifications_${user.id}`;
    const current = recentNotifications.items.map((item) => item.id);
    let previous = [];
    try { previous = JSON.parse(sessionStorage.getItem(key) ?? '[]'); } catch { previous = []; }
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, JSON.stringify(current));
      return;
    }
    const fresh = recentNotifications.items.filter((item) => !previous.includes(item.id));
    sessionStorage.setItem(key, JSON.stringify(current));
    fresh.forEach((_, index) => window.setTimeout(playNotificationSound, index * 320));
    if (document.visibilityState !== 'visible' || !fresh.length) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      void navigator.serviceWorker.ready
        .then((registration) => Promise.all(
          fresh.slice(0, 3).reverse().map((item) =>
            registration.showNotification(item.title, {
              body: item.body,
              icon: '/Tadreeby%20Emblem.svg',
              badge: '/Tadreeby%20Emblem.svg',
              tag: item.id,
              data: { url: item.url || '/notifications' },
            }),
          ),
        ))
        .catch((error) => {
          console.error('Could not show desktop notification:', error);
        });
    }
  }, [recentNotifications, user?.id]);

  const workspace =
    user?.memberships.find((m) => m.workspace.id === localStorage.getItem('tth_workspace'))?.workspace ??
    user?.memberships[0]?.workspace;

  const submitSearch = (e) => {
    e.preventDefault();
    if (query.trim()) navigate(`/tasks?q=${encodeURIComponent(query.trim())}`);
  };

  const visibleMain = NAV_MAIN.filter((n) => !n.leaderOnly || role === 'LEADER');
  const visibleAdmin = NAV_ADMIN.filter((n) => !n.leaderOnly || role === 'LEADER');
  const personalItems = [
    { to: '/notifications', labelKey: 'notifications', icon: Bell },
    { to: '/settings', labelKey: 'settings', icon: Settings },
  ];

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <aside
        className={`fixed inset-y-0 start-0 z-40 hidden flex-col border-e border-gray-200 bg-white transition-all duration-200 lg:flex ${collapsed ? 'w-[52px]' : 'w-[240px]'}`}
      >
        <div className="flex h-12 items-center gap-2 px-2">
          <button
            onClick={() => collapsed && setCollapsed(false)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-start transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <img src="/Tadreeby%20Emblem.svg" alt="Tadreeby" className="h-auto w-8 shrink-0" />
            {!collapsed && <>
              <span className="truncate text-[13px] font-medium">{workspace?.name ?? 'Tadreeby'}</span>
              <ChevronDown className="size-3.5 shrink-0 text-gray-400" />
            </>}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {visibleMain.map((item) => <SidebarLink key={item.to} {...item} collapsed={collapsed} />)}
          {visibleAdmin.length > 0 && <>
            <div className={`mb-1 mt-4 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 ${collapsed ? 'text-center' : ''}`}>
              {collapsed ? '···' : t('nav.workspace')}
            </div>
            {visibleAdmin.map((item) => <SidebarLink key={item.to} {...item} collapsed={collapsed} />)}
          </>}
          <div className={`mb-1 mt-4 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 ${collapsed ? 'text-center' : ''}`}>
            {collapsed ? '···' : t('nav.personal')}
          </div>
          {personalItems.map((item) => (
            <SidebarLink key={item.to} {...item} collapsed={collapsed} unread={unread?.count} />
          ))}
        </nav>

        <div className="border-t border-gray-200 p-2 dark:border-gray-800">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-start transition hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <div className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#2563EB] to-[#F97316] text-[10px] font-semibold text-white">
              {user?.name?.charAt(0).toUpperCase() ?? '?'}
            </div>
            {!collapsed && <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{user?.name}</div>
              <div className="truncate text-[11px] text-gray-400">{role === 'LEADER' ? t('auth.leader') : t('auth.member')}</div>
            </div>}
          </button>

          {menuOpen && !collapsed && <div className="mt-1 rounded-md border border-gray-200 bg-white py-1 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="px-3 py-1.5 text-[12px] text-gray-500">{user?.email}</div>
            <div className="my-1 h-px bg-gray-200 dark:bg-gray-800" />
            <LanguageSwitcher />
            <button onClick={() => void logout()} className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-[13px] text-red-600 transition hover:bg-gray-100 dark:hover:bg-gray-800">
              {t('auth.signOut')}
            </button>
          </div>}
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden">
        <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
        <aside className="absolute inset-y-0 start-0 w-64 bg-white p-2">
          <div className="mb-3 px-2 py-1 text-[13px] font-semibold">{workspace?.name}</div>
          {[...visibleMain, ...visibleAdmin, ...personalItems].map((item) => (
            <SidebarLink key={item.to} {...item} onClick={() => setMobileOpen(false)} unread={unread?.count} />
          ))}
          <LanguageSwitcher />
        </aside>
      </div>}

      <div className={`flex min-h-dvh flex-col transition-[padding] ${collapsed ? 'lg:ps-[52px]' : 'lg:ps-[240px]'}`}>
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-gray-200 bg-white px-3">
          <button onClick={() => setMobileOpen(true)} className="grid size-7 place-items-center rounded-md transition hover:bg-gray-100 lg:hidden dark:hover:bg-gray-800" aria-label={t('common.expand')}>
            <Menu className="size-4" />
          </button>
          {collapsed && <button onClick={() => setCollapsed(false)} className="hidden size-7 place-items-center rounded-md transition hover:bg-gray-100 lg:grid dark:hover:bg-gray-800" aria-label={t('common.expand')}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </button>}
          <form onSubmit={submitSearch} className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
            <input id="global-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.searchOrJump')} className="w-full rounded-md border border-gray-200 bg-gray-50 py-1 ps-8 pe-3 text-[13px] outline-none transition placeholder:text-gray-400 focus:border-[#2563EB] focus:bg-white dark:border-gray-800 dark:bg-gray-900 dark:focus:bg-gray-950" />
          </form>
          <div className="ms-auto flex items-center gap-1">
            <LanguageSwitcher />
            {role === 'LEADER' && <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-md bg-[#2563EB] px-2.5 py-1 text-[13px] font-medium text-white transition hover:bg-[#1D4ED8]">
              <Plus className="size-3.5" /><span className="hidden sm:inline">{t('common.new')}</span>
            </button>}
            <NavLink to="/notifications" className="relative grid size-7 place-items-center rounded-md transition hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={t('nav.notifications')}>
              <Bell className="size-4" />
              {(unread?.count ?? 0) > 0 && <span className="absolute -end-0.5 -top-0.5 grid min-w-3.5 place-items-center rounded-full bg-[#F97316] px-1 text-[9px] font-bold text-white">{unread.count > 9 ? '9+' : unread.count}</span>}
            </NavLink>
          </div>
        </header>
        <main className="flex-1 bg-white px-4 py-6 sm:px-6 sm:py-7 lg:px-8 lg:py-8"><Outlet /></main>
      </div>
      {creating && <QuickCreateTask onClose={() => setCreating(false)} />}
    </div>
  );
}

function SidebarLink({ to, labelKey, icon: Icon, collapsed, unread, onClick }) {
  const { t } = useTranslation();
  const label = t(`nav.${labelKey}`);
  return <NavLink to={to} end={to === '/'} onClick={onClick} title={collapsed ? label : undefined}
    className={({ isActive }) => `group flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition ${isActive ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'} ${collapsed ? 'justify-center px-2' : ''}`}>
    <Icon className="size-4 shrink-0 opacity-80" />
    {!collapsed && <span className="truncate">{label}</span>}
    {!collapsed && unread > 0 && labelKey === 'notifications' && <span className="ms-auto grid min-w-4 place-items-center rounded-full bg-[#2563EB] px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
  </NavLink>;
}
