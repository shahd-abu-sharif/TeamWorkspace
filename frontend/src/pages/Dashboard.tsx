// apps/web/src/pages/Dashboard.tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, CheckCircle2, ListTodo, TrendingUp } from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTranslation } from 'react-i18next';

export function DashboardPage() {
    const { role } = useAuth();
    const { data, isLoading, error } = useQuery({
        queryKey: ['dashboard'],
        queryFn: () => apiClient.get<any>('/dashboard'),
        refetchInterval: 15_000,
    });

    if (isLoading) return <DashboardSkeleton />;
    if (error) return <ErrorState message={(error as Error).message} />;
    if (!data) return null;

    return role === 'LEADER' ? <LeaderDashboard data={data} /> : <MemberDashboard data={data} />;
}

function LeaderDashboard({ data }: { data: any }) {
    const { t } = useTranslation();
    const { totals, workload, teamTimeToday = [], upcoming, recentActivity, byStatus, byPriority } = data;

    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-2xl font-semibold">{t('dashboard.teamTitle')}</h1>
                <p className="text-sm text-slate-500">{t('dashboard.teamSubtitle')}</p>
            </header>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Metric icon={ListTodo} label={t('dashboard.totalTasks')} value={totals.total} />
                <Metric icon={CheckCircle2} label={t('dashboard.completed')} value={totals.done} tone="good" />
                <Metric icon={TrendingUp} label={t('dashboard.inProgress')} value={totals.inProgress} />
                <Metric
                    icon={AlertCircle}
                    label={t('dashboard.overdue')}
                    value={totals.overdue}
                    tone={totals.overdue ? 'bad' : undefined}
                />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="mb-4 font-semibold">{t('dashboard.teamWorkload')}</h2>
                    {workload.length === 0 ? (
                        <EmptyState message={t('dashboard.noActiveMembers')} />
                    ) : (
                        <div className="space-y-4">
                            {workload.map((member: any) => {
                                const maxHours = Math.max(...workload.map((w: any) => w.estimatedHours), 1);
                                return (
                                    <div key={member.userId}>
                                        <div className="mb-1 flex items-center justify-between text-sm">
                                            <span className="font-medium">{member.name}</span>
                                            <span className="text-slate-500">
                                                {t('dashboard.workloadSummary', { count: member.activeTasks, hours: member.estimatedHours.toFixed(1) })}
                                            </span>
                                        </div>
                                        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                            <div
                                                className="h-full rounded-full bg-[#2563EB] transition-all"
                                                style={{ width: `${Math.min(100, (member.estimatedHours / maxHours) * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <p className="mt-4 text-xs text-slate-500">
                        {t('dashboard.workloadNote')}
                    </p>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="mb-4 font-semibold">{t('dashboard.overallProgress')}</h2>
                    <div className="flex items-center justify-center py-4">
                        <ProgressRing percent={totals.completionPercent} />
                    </div>
                    <dl className="mt-4 space-y-2 text-sm">
                        <Row label={t('dashboard.notStarted')} value={(byStatus.BACKLOG ?? 0) + (byStatus.TODO ?? 0)} />
                        <Row label={t('dashboard.blocked')} value={byStatus.BLOCKED ?? 0} />
                        <Row label={t('dashboard.awaitingReview')} value={totals.awaitingReview} />
                        <Row label={t('dashboard.unassigned')} value={totals.unassigned} />
                        <Row label={t('dashboard.dueWithin7Days')} value={totals.dueSoon} />
                    </dl>
                </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 className="font-semibold">Team time today</h2>
                        <p className="mt-1 text-xs text-slate-500">Tracked from each task’s first move to In Progress.</p>
                    </div>
                    <span className="text-xs text-slate-400">Updates every 15 seconds</span>
                </div>
                {teamTimeToday.length === 0 ? <EmptyState message={t('dashboard.noActiveMembers')} /> : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {teamTimeToday.map((member: any) => (
                            <div key={member.userId} className="rounded-lg border border-slate-200 p-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-sm font-medium">{member.name}</span>
                                    <span className={`inline-flex items-center gap-1.5 text-xs ${member.activeTasks.length ? 'text-emerald-700' : 'text-slate-500'}`}>
                                        <span className={`size-2 rounded-full ${member.activeTasks.length ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
                                        {member.activeTasks.length ? 'Working now' : member.openedToday ? 'Opened today' : 'Not active today'}
                                    </span>
                                </div>
                                <p className="mt-2 text-xl font-semibold tabular-nums">{formatWorkedTime(member.workedSecondsToday)}</p>
                                {member.activeTasks.length > 0 && <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                                    {member.activeTasks.map((task: any) => <li key={task.id} className="truncate text-xs text-slate-500">#{task.reference} {task.title}</li>)}
                                </ul>}
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="mb-4 font-semibold">{t('dashboard.upcomingDeadlines')}</h2>
                    {upcoming.length === 0 ? (
                        <EmptyState message={t('dashboard.noUpcomingDeadlines')} />
                    ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                            {upcoming.map((task: any) => (
                                <li key={task.id} className="flex items-center gap-3 py-2.5">
                                    <PriorityDot priority={task.priority} />
                                    <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-[#2563EB]">
                                        #{task.reference} {task.title}
                                    </Link>
                                    <span className="whitespace-nowrap text-xs text-slate-500">
                                        {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="mb-4 font-semibold">{t('dashboard.recentActivity')}</h2>
                    {recentActivity.length === 0 ? (
                        <EmptyState message={t('dashboard.noRecentActivity')} />
                    ) : (
                        <ul className="space-y-3">
                            {recentActivity.map((a: any) => (
                                <li key={a.id} className="flex gap-3 text-sm">
                                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#2563EB]/10 text-xs font-semibold text-[#2563EB]">
                                        {a.actor.name.charAt(0).toUpperCase()}
                                    </span>
                                    <p className="text-slate-600 dark:text-slate-400">
                                        <span className="font-medium text-slate-900 dark:text-slate-100">{a.actor.name}</span>{' '}
                                        {a.summary}
                                        {a.task && (
                                            <Link to={`/tasks/${a.task.id}`} className="ms-1 text-[#2563EB] hover:underline">
                                                #{a.task.reference}
                                            </Link>
                                        )}
                                        <span className="ms-2 text-xs text-slate-400">
                                            {new Date(a.createdAt).toLocaleString()}
                                        </span>
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>

            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-4 font-semibold">{t('dashboard.tasksByPriority')}</h2>
                <div className="flex flex-wrap gap-3">
                    {Object.entries(byPriority).map(([priority, count]) => (
                        <div key={priority} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                            <PriorityDot priority={priority} />
                            <span className="text-sm font-medium">{t(`priority.${priority}`)}</span>
                            <span className="text-sm text-slate-500">{count as number}</span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

function formatWorkedTime(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function MemberDashboard({ data }: { data: any }) {
    const { t } = useTranslation();
    const { totals, tasks, upcoming } = data;
    return (
        <div className="space-y-6">
            <header>
                <h1 className="text-2xl font-semibold">{t('dashboard.memberTitle')}</h1>
                <p className="text-sm text-slate-500">{t('dashboard.memberSubtitle')}</p>
            </header>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Metric icon={ListTodo} label={t('dashboard.assignedToMe')} value={totals.assigned} />
                <Metric icon={CalendarClock} label={t('dashboard.dueToday')} value={totals.dueToday} tone={totals.dueToday ? 'warn' : undefined} />
                <Metric icon={AlertCircle} label={t('dashboard.overdue')} value={totals.overdue} tone={totals.overdue ? 'bad' : undefined} />
                <Metric icon={CheckCircle2} label={t('dashboard.completed')} value={totals.completed} tone="good" />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
                    <h2 className="mb-4 font-semibold">{t('dashboard.myTasks')}</h2>
                    {tasks.length === 0 ? (
                        <EmptyState message={t('tasks.noAssignedTasks')} />
                    ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                            {tasks.slice(0, 10).map((task: any) => (
                                <li key={task.id} className="flex items-center gap-3 py-2.5">
                                    <PriorityDot priority={task.priority} />
                                    <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-[#2563EB]">
                                        #{task.reference} {task.title}
                                    </Link>
                                    <StatusBadge status={task.status} />
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="space-y-6">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">{t('dashboard.personalCompletion')}</h2>
                        <div className="flex justify-center py-2">
                            <ProgressRing percent={totals.completionPercent} />
                        </div>
                        <dl className="mt-4 space-y-2 text-sm">
                            <Row label={t('dashboard.estimatedHours')} value={`${totals.estimatedHours}h`} />
                            <Row label={t('dashboard.loggedHours')} value={`${totals.loggedHours}h`} />
                            <Row label={t('dashboard.awaitingReview')} value={totals.awaitingReview} />
                        </dl>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">{t('dashboard.upcomingDeadlines')}</h2>
                        {upcoming.length === 0 ? (
                            <EmptyState message={t('dashboard.noUpcomingDeadlines')} />
                        ) : (
                            <ul className="space-y-2 text-sm">
                                {upcoming.map((task: any) => (
                                    <li key={task.id} className="flex items-center justify-between gap-2">
                                        <Link to={`/tasks/${task.id}`} className="min-w-0 truncate hover:text-[#2563EB]">
                                            {task.title}
                                        </Link>
                                        <span className="whitespace-nowrap text-xs text-slate-500">
                                            {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- shared bits

export function Metric({
    icon: Icon,
    label,
    value,
    tone,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: number;
    tone?: 'good' | 'warn' | 'bad';
}) {
    const toneClass =
        tone === 'good'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'warn'
                ? 'text-[#b45309] dark:text-[#FCA840]'
                : tone === 'bad'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-900 dark:text-slate-100';
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-slate-500">
                <Icon className="size-4" />
                <span className="text-xs font-medium">{label}</span>
            </div>
            <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
        </div>
    );
}

export function ProgressRing({ percent }: { percent: number }) {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;
    return (
        <div className="relative size-32">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
                <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="10" className="stroke-slate-100 dark:stroke-slate-800" />
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className="stroke-[#2563EB] transition-[stroke-dashoffset] duration-700"
                />
            </svg>
            <span className="absolute inset-0 grid place-items-center text-2xl font-semibold">{percent}%</span>
        </div>
    );
}

export function PriorityDot({ priority }: { priority: string }) {
    const { t } = useTranslation();
    const color: Record<string, string> = {
        URGENT: 'bg-red-500',
        HIGH: 'bg-[#FCA840]',
        MEDIUM: 'bg-[#2563EB]',
        LOW: 'bg-slate-400',
    };
    return <span className={`size-2.5 shrink-0 rounded-full ${color[priority] ?? 'bg-slate-300'}`} title={t(`priority.${priority}`)} />;
}

export function StatusBadge({ status }: { status: string }) {
    const { t } = useTranslation();
    const style: Record<string, string> = {
        BACKLOG: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
        TODO: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
        IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
        IN_REVIEW: 'bg-[#FCA840]/20 text-[#b45309] dark:text-[#FCA840]',
        BLOCKED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
        DONE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    };
    return (
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${style[status] ?? ''}`}>
            {t(`status.${status}`)}
        </span>
    );
}

export function Row({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="flex items-center justify-between">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium">{value}</dd>
        </div>
    );
}

export function EmptyState({ message }: { message: string }) {
    return (
        <div className="grid place-items-center rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400 dark:border-slate-700">
            {message}
        </div>
    );
}

export function ErrorState({ message }: { message: string }) {
    const { t } = useTranslation();
    return (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            <p className="font-semibold">{t('common.error')}</p>
            <p className="mt-1">{message}</p>
        </div>
    );
}

function DashboardSkeleton() {
    return (
        <div className="space-y-6">
            <div className="h-8 w-56 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
                ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
                <div className="h-72 animate-pulse rounded-xl bg-slate-200 lg:col-span-2 dark:bg-slate-800" />
                <div className="h-72 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
            </div>
        </div>
    );
}
