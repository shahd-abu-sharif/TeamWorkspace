// apps/web/src/pages/Teams.tsx
//
// Teams are per-discipline groups inside a workspace. Each team can own epics,
// and a task in a team-owned epic may only be assigned to that team's members
// (enforced by the API). Deleting a team never deletes work: its epics simply
// become team-less, so the UI says so before confirming.
import { useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Boxes, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { epicCode } from '../lib/epic-key';
import { btnDanger, btnPrimary, btnSecondary, Field, input } from '../components/QuickCreateTask';
import { StatusBadge } from './Dashboard';
import { TeamDiscussions } from './Discussions';

const TEAM_TYPES = ['UIUX', 'FRONTEND', 'BACKEND', 'MOBILE', 'OTHER'] as const;
const ROLES = ['LEAD', 'MEMBER'] as const;

const TYPE_LABEL_KEY: Record<string, string> = {
    UIUX: 'epics.types.uiux',
    FRONTEND: 'epics.types.frontend',
    BACKEND: 'epics.types.backend',
    MOBILE: 'epics.types.mobile',
    OTHER: 'epics.types.other',
};

interface TeamMember {
    id: string;
    userId: string;
    roleInTeam: string;
    user: { id: string; name: string; email: string; avatarUrl: string | null; jobTitle: string | null };
}

interface TeamSummary {
    id: string;
    name: string;
    description: string | null;
    type: string;
    memberCount: number;
    epicCount: number;
    openTasks: number;
}

interface TeamEpic {
    id: string;
    reference: number;
    title: string;
    status: string;
    dueDate: string | null;
    taskCount: number;
    openTasks: number;
}

interface TeamDetail extends TeamSummary {
    members: TeamMember[];
    epics: TeamEpic[];
}

interface Workload {
    teamId: string;
    teamName: string;
    type: string;
    openTasks: number;
    unassignedTasks: number;
    members: {
        userId: string;
        name: string;
        avatarUrl: string | null;
        jobTitle: string | null;
        roleInTeam: string;
        openTasks: number;
        openEstimatedHrs: number;
        loggedHours: number;
    }[];
}

interface WorkspaceMember {
    id: string;
    role: string;
    isActive: boolean;
    user: { id: string; name: string; email: string };
}

const fmtDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : '—');

export function TeamsPage() {
    const { t } = useTranslation();
    const { role } = useAuth();
    const [creating, setCreating] = useState(false);

    const { data: teams = [], isLoading, error } = useQuery({
        queryKey: ['teams'],
        queryFn: () => apiClient.get<TeamSummary[]>('/teams'),
    });

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold">{t('teams.title')}</h1>
                    <p className="mt-2 text-sm text-slate-500">{t('teams.subtitle')}</p>
                </div>
                {role === 'LEADER' && (
                    <button onClick={() => setCreating(true)} className={btnPrimary}>
                        <Plus className="me-1 inline size-4" /> {t('teams.new')}
                    </button>
                )}
            </header>

            {isLoading && <p className="py-8 text-sm text-slate-500">{t('common.loading')}</p>}
            {error && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {(error as Error).message}
                </p>
            )}

            {!isLoading && !error && teams.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
                    <Boxes className="mx-auto size-6 text-slate-400" />
                    <p className="mt-3 text-sm text-slate-500">{t('teams.empty')}</p>
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                {teams.map((team) => (
                    <Link
                        key={team.id}
                        to={`/teams/${team.id}`}
                        className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <h2 className="truncate font-semibold">{team.name}</h2>
                            <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#1D4ED8]">
                                {t(TYPE_LABEL_KEY[team.type] ?? 'epics.types.other')}
                            </span>
                        </div>
                        {team.description && (
                            <p className="mt-2 line-clamp-2 text-sm text-slate-500">{team.description}</p>
                        )}
                        <p className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                                <Users className="size-3.5" /> {t('teams.memberCount', { count: team.memberCount })}
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <Boxes className="size-3.5" /> {t('teams.epicCount', { count: team.epicCount })}
                            </span>
                            <span>{t('teams.openTasks', { count: team.openTasks })}</span>
                        </p>
                    </Link>
                ))}
            </div>

            {creating && <TeamFormModal onClose={() => setCreating(false)} />}
        </div>
    );
}

export function TeamDetailPage() {
    const { id = '' } = useParams();
    const { t } = useTranslation();
    const { role, user } = useAuth();
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [memberId, setMemberId] = useState('');
    const [memberRole, setMemberRole] = useState<string>('MEMBER');
    const [actionError, setActionError] = useState('');

    const { data: team, isLoading, error } = useQuery({
        queryKey: ['team', id],
        queryFn: () => apiClient.get<TeamDetail>(`/teams/${id}`),
        enabled: Boolean(id),
    });

    const { data: workload } = useQuery({
        queryKey: ['team-workload', id],
        queryFn: () => apiClient.get<Workload>(`/teams/${id}/workload`),
        enabled: Boolean(id),
    });

    const { data: workspaceMembers = [] } = useQuery({
        queryKey: ['members'],
        queryFn: () => apiClient.get<WorkspaceMember[]>('/members'),
    });

    const invalidate = () => {
        void qc.invalidateQueries({ queryKey: ['team', id] });
        void qc.invalidateQueries({ queryKey: ['teams'] });
        void qc.invalidateQueries({ queryKey: ['team-workload', id] });
        void qc.invalidateQueries({ queryKey: ['epics'] });
    };

    const remove = useMutation({
        mutationFn: () => apiClient.delete<{ detachedEpics: number }>(`/teams/${id}`),
        onSuccess: (result) => {
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['epics'] });
            navigate('/teams', {
                state: { message: t('teams.deleted', { count: result?.detachedEpics ?? 0 }) },
            });
        },
        onError: (mutationError) => setActionError((mutationError as Error).message),
    });

    const addMember = useMutation({
        mutationFn: () => apiClient.post(`/teams/${id}/members`, { userId: memberId, roleInTeam: memberRole }),
        onSuccess: () => {
            setMemberId('');
            setMemberRole('MEMBER');
            setActionError('');
            invalidate();
        },
        onError: (mutationError) => setActionError((mutationError as Error).message),
    });

    const removeMember = useMutation({
        mutationFn: (userId: string) => apiClient.delete(`/teams/${id}/members/${userId}`),
        onSuccess: () => {
            setActionError('');
            invalidate();
        },
        onError: (mutationError) => setActionError((mutationError as Error).message),
    });

    if (isLoading) return <p className="py-8 text-sm text-slate-500">{t('common.loading')}</p>;
    if (error || !team) {
        return <p role="alert" className="text-sm text-red-600">{(error as Error)?.message ?? t('teams.notFound')}</p>;
    }

    const isTeamLead = team.members.some((member) => member.userId === user?.id && member.roleInTeam === 'LEAD');
    const canManage = role === 'LEADER' || isTeamLead;
    const memberIds = new Set(team.members.map((member) => member.userId));
    const addableMembers = workspaceMembers
        .filter((member) => member.isActive && !memberIds.has(member.user.id))
        .sort((a, b) => {
            if (a.user.id === user?.id) return -1;
            if (b.user.id === user?.id) return 1;
            return a.user.name.localeCompare(b.user.name);
        });
    const workloadByUser = new Map((workload?.members ?? []).map((row) => [row.userId, row]));

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <Link to="/teams" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
                <ArrowLeft className="size-4" /> {t('teams.back')}
            </Link>

            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-semibold">{team.name}</h1>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-[#1D4ED8]">
                            {t(TYPE_LABEL_KEY[team.type] ?? 'epics.types.other')}
                        </span>
                        {t('teams.openTasks', { count: workload?.openTasks ?? team.openTasks })}
                    </p>
                    {team.description && <p className="mt-2 text-sm text-slate-600">{team.description}</p>}
                </div>
                {role === 'LEADER' && (
                    <div className="flex gap-2">
                        <button onClick={() => setEditing(true)} className={btnSecondary}>
                            <Pencil className="me-1 inline size-4" /> {t('common.edit')}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm(t('teams.deleteConfirm', { name: team.name }))) remove.mutate();
                            }}
                            className={btnDanger}
                        >
                            <Trash2 className="me-1 inline size-4" /> {t('common.delete')}
                        </button>
                    </div>
                )}
            </header>

            {actionError && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {actionError}
                </p>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-3 flex items-center gap-2 font-semibold">
                    <Users className="size-4 text-slate-500" /> {t('teams.members')} ({team.members.length})
                </h2>
                {team.members.length === 0 ? (
                    <p className="text-sm text-slate-400">{t('teams.noMembers')}</p>
                ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {team.members.map((member) => {
                            const load = workloadByUser.get(member.userId);
                            return (
                                <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                                    <div className="grid size-9 place-items-center rounded-full bg-blue-100 text-sm font-semibold text-[#1D4ED8]">
                                        {member.user.name.slice(0, 1).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                            {member.user.name}
                                            {member.roleInTeam === 'LEAD' && (
                                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                                    {t('teams.lead')}
                                                </span>
                                            )}
                                        </p>
                                        <p className="mt-0.5 text-xs text-slate-500">
                                            {member.user.jobTitle ? `${member.user.jobTitle} · ` : ''}
                                            {member.user.email}
                                        </p>
                                    </div>
                                    {load && (
                                        <p className="text-xs text-slate-500">
                                            {t('teams.workloadRow', {
                                                open: load.openTasks,
                                                hours: load.openEstimatedHrs,
                                            })}
                                        </p>
                                    )}
                                    {canManage && (
                                        <button
                                            onClick={() => removeMember.mutate(member.userId)}
                                            disabled={removeMember.isPending}
                                            className="rounded-md p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                                            aria-label={t('teams.removeMember', { name: member.user.name })}
                                            title={t('teams.removeMember', { name: member.user.name })}
                                        >
                                            <X className="size-4" />
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}

                {canManage && (
                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!memberId) return;
                            setActionError('');
                            addMember.mutate();
                        }}
                        className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-800"
                    >
                        <label className="min-w-48 flex-1 space-y-1.5 text-sm font-medium">
                            {t('teams.addMember')}
                            <select
                                value={memberId}
                                onChange={(e) => setMemberId(e.target.value)}
                                className={input}
                                required
                            >
                                <option value="">{t('teams.chooseMember')}</option>
                                {addableMembers.map((member) => (
                                    <option key={member.id} value={member.user.id}>
                                        {member.user.name}
                                        {member.user.id === user?.id ? ` (${t('teams.you')})` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="space-y-1.5 text-sm font-medium">
                            {t('teams.role')}
                            <select
                                value={memberRole}
                                onChange={(e) => setMemberRole(e.target.value)}
                                className={input}
                            >
                                {ROLES.map((teamRole) => (
                                    <option key={teamRole} value={teamRole}>
                                        {teamRole === 'LEAD' ? t('teams.lead') : t('teams.member')}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="submit"
                            disabled={addMember.isPending || !memberId}
                            className={btnPrimary}
                        >
                            <UserPlus className="me-1 inline size-4" /> {t('teams.add')}
                        </button>
                    </form>
                )}

                {workload?.unassignedTasks ? (
                    <p className="mt-3 text-xs text-amber-700">
                        {t('teams.unassignedWarning', { count: workload.unassignedTasks })}
                    </p>
                ) : null}
            </section>

            <TeamDiscussions teamId={team.id} />

            <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-3 flex items-center gap-2 font-semibold">
                    <Boxes className="size-4 text-slate-500" /> {t('teams.epics')} ({team.epics.length})
                </h2>
                {team.epics.length === 0 ? (
                    <p className="text-sm text-slate-400">{t('teams.noEpics')}</p>
                ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                        {team.epics.map((epic) => (
                            <li key={epic.id} className="flex flex-wrap items-center gap-3 py-3">
                                <Link to={`/epics/${epic.id}`} className="min-w-0 flex-1 hover:underline">
                                    <p className="truncate text-sm font-medium">
                                        <span className="text-slate-400">{epicCode(epic)}</span> {epic.title}
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                        {t('epics.progress', { open: epic.openTasks, total: epic.taskCount })} ·{' '}
                                        {fmtDate(epic.dueDate)}
                                    </p>
                                </Link>
                                <StatusBadge status={epic.status} />
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {editing && <TeamFormModal team={team} onClose={() => setEditing(false)} />}
        </div>
    );
}

function TeamFormModal({ team, onClose }: { team?: TeamDetail; onClose: () => void }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const { user } = useAuth();
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    // userId -> roleInTeam, chosen from the workspace's existing people.
    const [picked, setPicked] = useState<Record<string, string>>({});
    const createdId = useRef<string | null>(null);
    const [form, setForm] = useState({
        name: team?.name ?? '',
        description: team?.description ?? '',
        type: team?.type ?? 'OTHER',
    });

    const { data: workspaceMembers = [] } = useQuery({
        queryKey: ['members'],
        queryFn: () => apiClient.get<WorkspaceMember[]>('/members'),
        enabled: !team,
    });

    const candidates = workspaceMembers
        .filter((member) => member.isActive)
        .filter((member) => {
            const query = search.trim().toLowerCase();
            if (!query) return true;
            return (
                member.user.name.toLowerCase().includes(query) ||
                member.user.email.toLowerCase().includes(query)
            );
        })
        .sort((a, b) => {
            if (a.user.id === user?.id) return -1;
            if (b.user.id === user?.id) return 1;
            return a.user.name.localeCompare(b.user.name);
        });

    const togglePicked = (userId: string, checked: boolean) =>
        setPicked((prev) => {
            const next = { ...prev };
            if (checked) next[userId] = 'MEMBER';
            else delete next[userId];
            return next;
        });

    const save = useMutation({
        mutationFn: async () => {
            const payload = {
                name: form.name.trim(),
                description: form.description.trim() || null,
                type: form.type,
            };
            if (team) return apiClient.patch(`/teams/${team.id}`, payload);

            // Reuse a team created by a previous attempt so a failed member add
            // never creates a duplicate team on retry.
            const created =
                createdId.current ?? ((await apiClient.post<{ id: string }>('/teams', payload)).id as string);
            createdId.current = created;

            const entries = Object.entries(picked);
            const results = await Promise.allSettled(
                entries.map(([userId, roleInTeam]) =>
                    apiClient.post(`/teams/${created}/members`, { userId, roleInTeam }),
                ),
            );
            const failed = results.filter((result) => result.status === 'rejected');
            if (failed.length) {
                const reason = (failed[0] as PromiseRejectedResult).reason as Error;
                throw new Error(
                    `${failed.length} of ${entries.length} member(s) could not be added: ${reason.message}`,
                );
            }
            return created;
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['teams'] });
            void qc.invalidateQueries({ queryKey: ['team', team?.id] });
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
                className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{team ? t('teams.edit') : t('teams.new')}</h2>
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
                    <Field label={t('teams.form.name')}>
                        <input
                            value={form.name}
                            onChange={(e) => update('name', e.target.value)}
                            className={input}
                            required
                            minLength={2}
                            maxLength={80}
                            autoFocus
                        />
                    </Field>
                    <Field label={t('teams.form.type')}>
                        <select
                            value={form.type}
                            onChange={(e) => update('type', e.target.value)}
                            className={input}
                        >
                            {TEAM_TYPES.map((type) => (
                                <option key={type} value={type}>
                                    {t(TYPE_LABEL_KEY[type] ?? 'epics.types.other')}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label={t('teams.form.description')}>
                        <textarea
                            value={form.description}
                            onChange={(e) => update('description', e.target.value)}
                            rows={3}
                            maxLength={500}
                            className={input}
                        />
                    </Field>

                    {!team && (
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="text-sm font-medium">{t('teams.form.members')}</span>
                                <span className="text-xs text-slate-500">{t('teams.form.membersHint')}</span>
                            </div>
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className={input}
                                placeholder={t('teams.form.searchMembers')}
                            />
                            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                                {candidates.length === 0 && (
                                    <li className="px-3 py-2 text-sm text-slate-500">{t('teams.form.noUsers')}</li>
                                )}
                                {candidates.map((member) => {
                                    const checked = member.user.id in picked;
                                    return (
                                        <li key={member.id} className="flex items-center gap-3 px-3 py-2">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) => togglePicked(member.user.id, e.target.checked)}
                                                className="size-4 accent-[#2563EB]"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm">
                                                    {member.user.name}
                                                    {member.user.id === user?.id && (
                                                        <span className="ms-1 text-xs text-[#2563EB]">({t('teams.you')})</span>
                                                    )}
                                                </p>
                                                <p className="truncate text-xs text-slate-500">{member.user.email}</p>
                                            </div>
                                            {checked && (
                                                <select
                                                    value={picked[member.user.id]}
                                                    onChange={(e) =>
                                                        setPicked((prev) => ({ ...prev, [member.user.id]: e.target.value }))
                                                    }
                                                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
                                                    aria-label={t('teams.role')}
                                                >
                                                    <option value="MEMBER">{t('teams.member')}</option>
                                                    <option value="LEAD">{t('teams.lead')}</option>
                                                </select>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                            <p className="text-xs text-slate-500">
                                {t('teams.form.selectedCount', { count: Object.keys(picked).length })}
                            </p>
                        </div>
                    )}
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
