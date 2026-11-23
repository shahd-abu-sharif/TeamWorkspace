// apps/web/src/pages/Epics.tsx
//
// Epics are the optional grouping layer above tasks: one epic -> many tasks.
// This screen is read-only for members; creating, editing and deleting are
// leader-only, matching the API (POST/PATCH/DELETE /epics are @Roles('LEADER')).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { epicCode } from '../lib/epic-key';
import { btnDanger, btnPrimary, btnSecondary, Field, input } from '../components/QuickCreateTask';
import { PriorityDot, StatusBadge } from './Dashboard';

const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'] as const;
const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;

interface Team {
    id: string;
    name: string;
    type: string;
}

interface EpicSummary {
    id: string;
    reference: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    startDate: string | null;
    dueDate: string | null;
    teams: { id: string; name: string; type: string; memberIds?: string[] }[];
    taskCount: number;
    openTasks: number;
}

interface EpicTask {
    id: string;
    reference: number;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    estimatedHrs: number | null;
    subtaskCount: number;
    assignees: { userId: string; user: { id: string; name: string; avatarUrl: string | null } }[];
}

interface EpicDetail extends Omit<EpicSummary, 'tasks'> {
    tasks: EpicTask[];
}

interface EpicWarning {
    code: 'ASSIGNEES_OUTSIDE_TEAM';
    message: string;
    tasks: { id: string; reference: number; title: string; assignees: { userId: string; name: string }[] }[];
}

const fmtDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : '—');
const progressOf = (epic: { taskCount: number; openTasks: number }) =>
    epic.taskCount ? Math.round(((epic.taskCount - epic.openTasks) / epic.taskCount) * 100) : 0;

/**
 * `teamId`: undefined = no filter (all epics), 'none' = epics without a team,
 * otherwise a team id.
 */
export function EpicsPage() {
    const { t } = useTranslation();
    const { role } = useAuth();
    const [teamFilter, setTeamFilter] = useState<string | undefined>(undefined);
    const [creating, setCreating] = useState(false);

    const { data: teams = [] } = useQuery({
        queryKey: ['teams'],
        queryFn: () => apiClient.get<Team[]>('/teams'),
    });

    const query = teamFilter === 'none' ? '?unassigned=true' : teamFilter ? `?teamId=${teamFilter}` : '';
    const { data: epics = [], isLoading, error } = useQuery({
        queryKey: ['epics', teamFilter],
        queryFn: () => apiClient.get<EpicSummary[]>(`/epics${query}`),
    });

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">{t('epics.title')}</h1>
                    <p className="mt-2 text-sm text-slate-500">{t('epics.subtitle')}</p>
                </div>
                {role === 'LEADER' && (
                    <button onClick={() => setCreating(true)} className={btnPrimary}>
                        <Plus className="me-1 inline size-4" />
                        {t('epics.new')}
                    </button>
                )}
            </header>

            <div className="flex flex-wrap items-center gap-2">
                <FilterChip active={teamFilter === undefined} onClick={() => setTeamFilter(undefined)}>
                    {t('epics.filters.all')}
                </FilterChip>
                <FilterChip active={teamFilter === 'none'} onClick={() => setTeamFilter('none')}>
                    {t('epics.filters.noTeam')}
                </FilterChip>
                {teams.map((team) => (
                    <FilterChip
                        key={team.id}
                        active={teamFilter === team.id}
                        onClick={() => setTeamFilter(team.id)}
                    >
                        {team.name}
                    </FilterChip>
                ))}
            </div>

            {isLoading && <p className="py-8 text-sm text-slate-500">{t('common.loading')}</p>}
            {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {(error as Error).message}
                </p>
            )}

            {!isLoading && !error && epics.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
                    <Layers className="mx-auto size-6 text-slate-400" />
                    <p className="mt-3 text-sm text-slate-500">{t('epics.empty')}</p>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {epics.map((epic) => (
                    <Link
                        key={epic.id}
                        to={`/epics/${epic.id}`}
                        className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-xs font-medium text-slate-400">{epicCode(epic)}</p>
                                <h2 className="mt-1 truncate font-semibold">{epic.title}</h2>
                            </div>
                            <PriorityDot priority={epic.priority} />
                        </div>

                        {epic.description && (
                            <p className="mt-2 line-clamp-2 text-sm text-slate-500">{epic.description}</p>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <StatusBadge status={epic.status} />
                            {epic.teams.length === 0 ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                    {t('epics.noTeam')}
                                </span>
                            ) : (
                                epic.teams.map((team) => (
                                    <span
                                        key={team.id}
                                        className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-xs text-[#1D4ED8] dark:bg-blue-950/40 dark:text-blue-300"
                                    >
                                        {team.name}
                                    </span>
                                ))
                            )}
                        </div>

                        <div className="mt-4">
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div className="h-full bg-[#2563EB]" style={{ width: `${progressOf(epic)}%` }} />
                            </div>
                            <p className="mt-1.5 text-xs text-slate-500">
                                {t('epics.progress', { open: epic.openTasks, total: epic.taskCount })}
                            </p>
                        </div>
                    </Link>
                ))}
            </div>

            {creating && <EpicFormModal onClose={() => setCreating(false)} />}
        </div>
    );
}

export function EpicDetailPage() {
    const { id = '' } = useParams();
    const { t } = useTranslation();
    const { role } = useAuth();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [warning, setWarning] = useState<EpicWarning | null>(null);

    const { data: epic, isLoading, error } = useQuery({
        queryKey: ['epic', id],
        queryFn: () => apiClient.get<EpicDetail>(`/epics/${id}`),
        enabled: Boolean(id),
    });

    const remove = useMutation({
        mutationFn: () => apiClient.delete<{ detachedTasks: number }>(`/epics/${id}`),
        onSuccess: (result) => {
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            navigate('/epics', {
                state: { message: t('epics.deleted', { count: result?.detachedTasks ?? 0 }) },
            });
        },
    });

    if (isLoading) return <p className="py-8 text-sm text-slate-500">{t('common.loading')}</p>;
    if (error || !epic) {
        return <p role="alert" className="text-sm text-red-600">{(error as Error)?.message ?? t('epics.notFound')}</p>;
    }

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <Link to="/epics" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                <ArrowLeft className="size-4" /> {t('epics.back')}
            </Link>

            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm text-slate-500">{epicCode(epic)}</p>
                    <h1 className="mt-1 text-2xl font-semibold">{epic.title}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={epic.status} />
                        <span className="inline-flex items-center gap-1.5 text-sm">
                            <PriorityDot priority={epic.priority} /> {epic.priority}
                        </span>
                        {epic.teams.length === 0 ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {t('epics.noTeam')}
                            </span>
                        ) : (
                            epic.teams.map((team) => (
                                <span
                                    key={team.id}
                                    className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-xs text-[#1D4ED8] dark:bg-blue-950/40 dark:text-blue-300"
                                >
                                    {team.name}
                                </span>
                            ))
                        )}
                    </div>
                </div>
                {role === 'LEADER' && (
                    <div className="flex gap-2">
                        <button onClick={() => setEditing(true)} className={btnSecondary}>
                            <Pencil className="me-1 inline size-4" /> {t('common.edit')}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm(t('epics.deleteConfirm', { title: epic.title }))) remove.mutate();
                            }}
                            className={btnDanger}
                        >
                            <Trash2 className="me-1 inline size-4" /> {t('common.delete')}
                        </button>
                    </div>
                )}
            </header>

            {warning && (
                <div
                    role="status"
                    className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
                >
                    <div className="flex items-start justify-between gap-3">
                        <p>{warning.message}</p>
                        <button onClick={() => setWarning(null)} aria-label={t('common.close')}>
                            <X className="size-4" />
                        </button>
                    </div>
                    <ul className="mt-2 list-inside list-disc space-y-0.5">
                        {warning.tasks.map((task) => (
                            <li key={task.id}>
                                #{task.reference} {task.title} — {task.assignees.map((a) => a.name).join(', ')}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-3 font-semibold">{t('epics.description')}</h2>
                {epic.description ? (
                    <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{epic.description}</p>
                ) : (
                    <p className="text-sm text-slate-400">{t('epics.noDescription')}</p>
                )}
                <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3 dark:border-slate-800">
                    <div>
                        <dt className="text-slate-500">{t('epics.startDate')}</dt>
                        <dd>{fmtDate(epic.startDate)}</dd>
                    </div>
                    <div>
                        <dt className="text-slate-500">{t('epics.dueDate')}</dt>
                        <dd>{fmtDate(epic.dueDate)}</dd>
                    </div>
                    <div>
                        <dt className="text-slate-500">{t('epics.progressLabel')}</dt>
                        <dd>
                            {t('epics.progress', { open: epic.openTasks, total: epic.taskCount })} ·{' '}
                            {progressOf(epic)}%
                        </dd>
                    </div>
                </dl>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-3 font-semibold">
                    {t('epics.tasks')}{' '}
                    <span className="text-sm font-normal text-slate-500">({epic.tasks.length})</span>
                </h2>
                {epic.tasks.length === 0 ? (
                    <p className="text-sm text-slate-400">{t('epics.noTasks')}</p>
                ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {epic.tasks.map((task) => (
                            <li key={task.id} className="flex flex-wrap items-center gap-3 py-3">
                                <Link to={`/tasks/${task.id}`} className="min-w-0 flex-1 hover:underline">
                                    <p className="truncate text-sm font-medium">
                                        <span className="text-slate-400">#{task.reference}</span> {task.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        {task.assignees.length
                                            ? task.assignees.map((a) => a.user.name).join(', ')
                                            : t('epics.unassigned')}
                                        {task.dueDate ? ` · ${fmtDate(task.dueDate)}` : ''}
                                        {task.subtaskCount ? ` · ${task.subtaskCount} ${t('epics.subtasks')}` : ''}
                                    </p>
                                </Link>
                                <StatusBadge status={task.status} />
                                <PriorityDot priority={task.priority} />
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {editing && (
                <EpicFormModal
                    epic={epic}
                    onClose={() => setEditing(false)}
                    onWarning={setWarning}
                />
            )}
        </div>
    );
}

function FilterChip({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-full border px-3 py-1 text-sm transition ${
                active
                    ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300'
            }`}
        >
            {children}
        </button>
    );
}

/**
 * Shared create/edit form. Editing returns `warning` when existing assignees
 * fall outside the newly selected team — tasks are never rewritten silently.
 */
function EpicFormModal({
    epic,
    onClose,
    onWarning,
}: {
    epic?: EpicDetail;
    onClose: () => void;
    onWarning?: (warning: EpicWarning | null) => void;
}) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        title: epic?.title ?? '',
        description: epic?.description ?? '',
        priority: epic?.priority ?? 'MEDIUM',
        status: epic?.status ?? 'BACKLOG',
        teamIds: epic?.teams?.map((team) => team.id) ?? [],
        startDate: epic?.startDate ? epic.startDate.slice(0, 10) : '',
        dueDate: epic?.dueDate ? epic.dueDate.slice(0, 10) : '',
    });

    const { data: teams = [] } = useQuery({
        queryKey: ['teams'],
        queryFn: () => apiClient.get<Team[]>('/teams'),
    });

    const save = useMutation({
        mutationFn: () => {
            const payload = {
                title: form.title.trim(),
                description: form.description.trim() || null,
                priority: form.priority,
                status: form.status,
                teamIds: form.teamIds,
                startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
                dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
            };
            if (epic) {
                return apiClient.patch<EpicSummary & { warning: EpicWarning | null }>(`/epics/${epic.id}`, payload);
            }
            return apiClient.post<EpicSummary>('/epics', payload);
        },
        onSuccess: (result) => {
            void qc.invalidateQueries({ queryKey: ['epics'] });
            void qc.invalidateQueries({ queryKey: ['epic', epic?.id] });
            if (epic && onWarning) onWarning((result as { warning?: EpicWarning | null }).warning ?? null);
            onClose();
        },
        onError: (mutationError) => setError((mutationError as Error).message),
    });

    const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    setError('');
                    save.mutate();
                }}
                className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{epic ? t('epics.edit') : t('epics.new')}</h2>
                    <button type="button" onClick={onClose} aria-label={t('common.close')}>
                        <X className="size-5" />
                    </button>
                </div>

                {error && (
                    <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}
                    </p>
                )}

                <div className="space-y-4">
                    <Field label={t('epics.form.title')}>
                        <input
                            value={form.title}
                            onChange={(e) => update('title', e.target.value)}
                            className={input}
                            required
                            minLength={2}
                            maxLength={200}
                            autoFocus
                        />
                    </Field>

                    <Field label={t('epics.form.description')}>
                        <textarea
                            value={form.description}
                            onChange={(e) => update('description', e.target.value)}
                            rows={3}
                            maxLength={10_000}
                            className={input}
                        />
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t('epics.form.team')}>
                            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                                {teams.length === 0 && (
                                    <p className="px-1 text-xs text-slate-500">{t('epics.noTeamsYet')}</p>
                                )}
                                {teams.map((team) => {
                                    const checked = form.teamIds.includes(team.id);
                                    return (
                                        <label
                                            key={team.id}
                                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) =>
                                                    update(
                                                        'teamIds',
                                                        e.target.checked
                                                            ? [...form.teamIds, team.id]
                                                            : form.teamIds.filter((id) => id !== team.id),
                                                    )
                                                }
                                                className="size-4 accent-[#2563EB]"
                                            />
                                            <span className="truncate">{team.name}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </Field>
                        <Field label={t('epics.form.status')}>
                            <select
                                value={form.status}
                                onChange={(e) => update('status', e.target.value)}
                                className={input}
                            >
                                {STATUSES.map((status) => (
                                    <option key={status} value={status}>
                                        {status.replace('_', ' ')}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label={t('epics.form.priority')}>
                            <select
                                value={form.priority}
                                onChange={(e) => update('priority', e.target.value)}
                                className={input}
                            >
                                {PRIORITIES.map((priority) => (
                                    <option key={priority} value={priority}>
                                        {priority}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Field label={t('epics.startDate')}>
                            <input
                                type="date"
                                value={form.startDate}
                                onChange={(e) => update('startDate', e.target.value)}
                                className={input}
                            />
                        </Field>
                        <Field label={t('epics.dueDate')}>
                            <input
                                type="date"
                                value={form.dueDate}
                                onChange={(e) => update('dueDate', e.target.value)}
                                className={input}
                            />
                        </Field>
                    </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className={btnSecondary}>
                        {t('common.cancel')}
                    </button>
                    <button type="submit" disabled={save.isPending} className={btnPrimary}>
                        {save.isPending ? t('common.saving') : t('common.save')}
                    </button>
                </div>
            </form>
        </div>
    );
}
