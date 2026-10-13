// apps/web/src/pages/Notifications.tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, BellRing, Check, CheckCheck, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { enablePush, pushState, syncPushSubscription } from '../lib/push';
import { btnPrimary, btnSecondary } from '../components/QuickCreateTask';
import { useTranslation } from 'react-i18next';

interface Notification {
    id: string;
    type: string;
    title: string;
    body: string;
    taskId: string | null;
    url: string | null;
    readAt: string | null;
    createdAt: string;
}

export function NotificationsPage() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [tab, setTab] = useState<'all' | 'unread'>('all');
    const [pushMessage, setPushMessage] = useState<string | null>(null);
    const [pushActive, setPushActive] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['notifications', tab],
        queryFn: () =>
            apiClient.get<{ items: Notification[]; unread: number }>(
                `/notifications?pageSize=50${tab === 'unread' ? '&unread=true' : ''}`,
            ),
    });

    const markRead = useMutation({
        mutationFn: (id: string) => apiClient.post(`/notifications/${id}/read`),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['notifications'] });
            void qc.invalidateQueries({ queryKey: ['unread-count'] });
        },
    });

    const markAll = useMutation({
        mutationFn: () => apiClient.post('/notifications/read-all'),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['notifications'] });
            void qc.invalidateQueries({ queryKey: ['unread-count'] });
        },
    });

    const state = pushState();

    useEffect(() => {
        let cancelled = false;
        syncPushSubscription()
            .then((active) => {
                if (!cancelled) setPushActive(active);
            })
            .catch((error) => {
                if (!cancelled) setPushMessage((error as Error).message);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const requestPush = async () => {
        setPushMessage(null);
        try {
            const result = await enablePush();
            setPushActive(result.ok);
            setPushMessage(result.ok
                ? t('notifications.enabled')
                : result.reason?.startsWith('notifications.')
                    ? t(result.reason)
                    : result.reason ?? t('notifications.enableError'));
        } catch (error) {
            setPushActive(false);
            setPushMessage((error as Error).message || t('notifications.enableError'));
        }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">{t('notifications.title')}</h1>
                    <p className="text-sm text-slate-500">
                        {data?.unread ? t('notifications.unreadCount', { count: data.unread }) : t('notifications.allCaughtUp')}
                    </p>
                </div>
                {tab === 'unread' && (data?.items.length ?? 0) > 0 && (
                    <button onClick={() => markAll.mutate()} className={btnSecondary}>
                        <CheckCheck className="me-1 inline size-4" /> {t('notifications.markAllRead')}
                    </button>
                )}
            </header>

            {/* Push permission is requested only here, after the user opts in. */}
            {!pushActive && (
                <section className="rounded-xl border border-[#2563EB]/30 bg-[#2563EB]/5 p-4">
                    <div className="flex items-start gap-3">
                        <Smartphone className="mt-0.5 size-5 shrink-0 text-[#2563EB]" />
                        <div className="flex-1">
                            <p className="font-medium">{t('notifications.enablePush')}</p>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                                {t('notifications.enablePushDescription')}
                            </p>
                            {state === 'denied' ? (
                                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                                    {t('notifications.blocked')}
                                </p>
                            ) : (
                                <button onClick={() => void requestPush()} className={`${btnPrimary} mt-3`}>
                                    <BellRing className="me-1 inline size-4" /> {t('notifications.enableButton')}
                                </button>
                            )}
                            {pushMessage && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{pushMessage}</p>}
                        </div>
                    </div>
                </section>
            )}

            {pushActive && (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                    <Check className="size-4" />
                    {t('notifications.enabled')}
                </div>
            )}

            <div className="flex gap-2">
                {(['all', 'unread'] as const).map((tabName) => (
                    <button
                        key={tabName}
                        onClick={() => setTab(tabName)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${tab === tabName ? 'bg-[#2563EB] text-white' : 'border border-slate-200 dark:border-slate-700'
                            }`}
                    >
                        {t(`notifications.${tabName}`)}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <div className="space-y-2">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
                    ))}
                </div>
            ) : data?.items.length === 0 ? (
                <div className="grid place-items-center rounded-xl border border-dashed border-slate-200 py-16 text-center dark:border-slate-700">
                    <Bell className="mb-2 size-8 text-slate-300" />
                    <p className="text-sm text-slate-500">{t('notifications.empty')}</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {data?.items.map((n) => (
                        <li
                            key={n.id}
                            className={`rounded-xl border p-4 transition ${n.readAt
                                    ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                                    : 'border-[#2563EB]/30 bg-[#2563EB]/5'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium">{n.title}</p>
                                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{n.body}</p>
                                    <p className="mt-1 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</p>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-2">
                                    {(n.taskId || n.url) && (
                                        <Link to={n.url || `/tasks/${n.taskId}`} className="text-xs text-[#2563EB] hover:underline">
                                            {n.type === 'CHAT_MESSAGE' ? t('notifications.openChat') : t('notifications.openTask')}
                                        </Link>
                                    )}
                                    {!n.readAt && (
                                        <button
                                            onClick={() => markRead.mutate(n.id)}
                                            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                                        >
                                            {t('notifications.markRead')}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
