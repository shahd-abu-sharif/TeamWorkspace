// apps/web/src/pages/Tasks.tsx
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, Upload } from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EmptyState, ErrorState, PriorityDot, StatusBadge } from './Dashboard';
import { btnSecondary } from '../components/QuickCreateTask';
import { useTranslation } from 'react-i18next';

interface Task {
    id: string;
    reference: number;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    estimatedHrs: number | null;
    assignees: { user: { id: string; name: string } }[];
    workstream?: { name: string; color: string } | null;
}

export function TasksPage({ mine = false }: { mine?: boolean }) {
    const { t } = useTranslation();
    const { role, user } = useAuth();
    const qc = useQueryClient();
    const [params, setParams] = useSearchParams();
    const [showFilters, setShowFilters] = useState(false);

    const filters = {
        q: params.get('q') ?? '',
        status: params.get('status') ?? '',
        priority: params.get('priority') ?? '',
        assigneeId: mine ? user?.id ?? '' : params.get('assigneeId') ?? '',
        overdue: params.get('overdue') === 'true',
        unassigned: params.get('unassigned') === 'true',
        awaitingReview: params.get('awaitingReview') === 'true',
    };

    const query = new URLSearchParams();
    if (filters.q) query.set('q', filters.q);
    if (filters.status) query.set('status', filters.status);
    if (filters.priority) query.set('priority', filters.priority);
    if (mine) query.set('mine', 'true');
    else if (filters.assigneeId) query.set('assigneeId', filters.assigneeId);
    if (filters.overdue) query.set('overdue', 'true');
    if (filters.unassigned) query.set('unassigned', 'true');
    if (filters.awaitingReview) query.set('awaitingReview', 'true');

    const { data, isLoading, error } = useQuery({
        queryKey: ['tasks', query.toString()],
        queryFn: () => apiClient.get<{ items: Task[]; total: number }>(`/tasks?${query.toString()}`),
    });

    const { data: members } = useQuery({
        queryKey: ['members'],
        queryFn: () => apiClient.get<{ user: { id: string; name: string } }[]>('/members'),
        enabled: role === 'LEADER',
    });

    const setFilter = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value);
        else next.delete(key);
        setParams(next);
    };

    const bulkStatus = useMutation({
        mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
            apiClient.patch('/tasks/bulk', { taskIds: ids, patch: { status } }),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
    });

    const [selected, setSelected] = useState<Set<string>>(new Set());

    const toggle = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });

    if (error) return <ErrorState message={(error as Error).message} />;

    const activeFilterCount = Object.entries(filters).filter(([key, value]) =>
        !(mine && key === 'assigneeId') && value !== '' && value !== false,
    ).length;

    return (
        <div className="space-y-4">
            <header className="flex flex-wrap items-center gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">{mine ? t('nav.myTasks') : t('nav.allTasks')}</h1>
                    <p className="text-sm text-slate-500">
                        {data ? t('tasks.showing', { count: data.total }) : t('common.loading')}
                    </p>
                </div>

                <div className="ms-auto flex flex-wrap gap-2">
                    <input
                        value={filters.q}
                        onChange={(e) => setFilter('q', e.target.value)}
                        placeholder={t('tasks.searchPlaceholder')}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                    />
                    <button onClick={() => setShowFilters((s) => !s)} className={btnSecondary}>
                        <Filter className="me-1 inline size-4" />
                        {t('tasks.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                    </button>
                    {role === 'LEADER' && (
                        <Link to="/import" className={btnSecondary}>
                            <Upload className="me-1 inline size-4" /> {t('nav.import')}
                        </Link>
                    )}
                </div>
            </header>

            {showFilters && (
                <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                    <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={fselect}>
                        <option value="">{t('tasks.anyStatus')}</option>
                        {['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].map((s) => (
                            <option key={s} value={s}>{t(`status.${s}`)}</option>
                        ))}
                    </select>
                    <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} className={fselect}>
                        <option value="">{t('tasks.anyPriority')}</option>
                        {['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((p) => (
                            <option key={p} value={p}>{t(`priority.${p}`)}</option>
                        ))}
                    </select>
                    {role === 'LEADER' && !mine && (
                        <select value={filters.assigneeId} onChange={(e) => setFilter('assigneeId', e.target.value)} className={fselect}>
                            <option value="">{t('tasks.anyone')}</option>
                            {members?.map((m) => (
                                <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
                            ))}
                        </select>
                    )}
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={filters.overdue} onChange={(e) => setFilter('overdue', e.target.checked ? 'true' : '')} />
                        {t('tasks.overdueOnly')}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={filters.unassigned} onChange={(e) => setFilter('unassigned', e.target.checked ? 'true' : '')} />
                        {t('tasks.unassignedOnly')}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={filters.awaitingReview} onChange={(e) => setFilter('awaitingReview', e.target.checked ? 'true' : '')} />
                        {t('tasks.awaitingReviewOnly')}
                    </label>
                </div>
            )}

            {role === 'LEADER' && selected.size > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-[#2563EB]/30 bg-[#2563EB]/5 p-3 text-sm">
                    <span className="font-medium">{t('tasks.selected', { count: selected.size })}</span>
                    <select
                        onChange={(e) => {
                            if (!e.target.value) return;
                            bulkStatus.mutate({ ids: [...selected], status: e.target.value });
                            setSelected(new Set());
                        }}
                        className={fselect}
                        defaultValue=""
                    >
                        <option value="">{t('tasks.changeStatus')}</option>
                        {['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].map((s) => (
                            <option key={s} value={s}>{t(`status.${s}`)}</option>
                        ))}
                    </select>
                    <button onClick={() => setSelected(new Set())} className="ms-auto text-xs underline">
                        {t('tasks.clear')}
                    </button>
                </div>
            )}

            {isLoading ? (
                <div className="space-y-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
                    ))}
                </div>
            ) : data?.items.length === 0 ? (
                <EmptyState message={mine ? t('tasks.noAssignedTasks') : t('tasks.noTasks')} />
            ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <table className="w-full text-sm">
                        <thead className="border-b border-slate-200 text-start text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                            <tr>
                                {role === 'LEADER' && <th className="w-10 p-3" />}
                                <th className="p-3">{t('tasks.title')}</th>
                                <th className="hidden p-3 sm:table-cell">{t('tasks.assignees')}</th>
                                <th className="hidden p-3 md:table-cell">{t('tasks.priority')}</th>
                                <th className="p-3">{t('tasks.status')}</th>
                                <th className="hidden p-3 md:table-cell">{t('tasks.deadline')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data?.items.map((task) => {
                                const overdue =
                                    task.dueDate && task.status !== 'DONE' && new Date(task.dueDate).getTime() < Date.now();
                                return (
                                    <tr key={task.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
                                        {role === 'LEADER' && (
                                            <td className="p-3">
                                                <input type="checkbox" checked={selected.has(task.id)} onChange={() => toggle(task.id)} />
                                            </td>
                                        )}
                                        <td className="p-3">
                                            <Link to={`/tasks/${task.id}`} className="font-medium hover:text-[#2563EB]">
                                                <span className="text-slate-400">#{task.reference}</span> {task.title}
                                            </Link>
                                            {task.workstream && (
                                                <span className="ms-2 inline-flex items-center gap-1 text-xs text-slate-500">
                                                    <span className="size-2 rounded-full" style={{ background: task.workstream.color }} />
                                                    {task.workstream.name}
                                                </span>
                                            )}
                                        </td>
                                        <td className="hidden p-3 text-slate-600 sm:table-cell dark:text-slate-400">
                                            {task.assignees.map((a) => a.user.name).join(', ') || (
                                                <span className="text-[#b45309]">{t('dashboard.unassigned')}</span>
                                            )}
                                        </td>
                                        <td className="hidden p-3 md:table-cell">
                                            <span className="inline-flex items-center gap-2">
                                                <PriorityDot priority={task.priority} />
                                                {t(`priority.${task.priority}`)}
                                            </span>
                                        </td>
                                        <td className="p-3"><StatusBadge status={task.status} /></td>
                                        <td className={`hidden p-3 md:table-cell ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-400'}`}>
                                            {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

const fselect =
    'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800';
