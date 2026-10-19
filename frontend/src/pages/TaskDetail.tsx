import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { btnPrimary, btnSecondary, btnDanger, input, Field } from '../components/QuickCreateTask';
import { ErrorState, PriorityDot, StatusBadge } from './Dashboard';
import {
    Download, Paperclip, Upload, Play, Pause, Clock, Link as LinkIcon,
    Plus, AlertTriangle, Users, Trash2, Pencil, ArrowUp, ArrowDown, X, MessageSquare,
} from 'lucide-react';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

const STATUSES = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'] as const;
const PRIORITIES = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;

const formatTime = (totalSecs: number) => {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = Math.floor(totalSecs % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatHHMM = (ms: number) => {
    const d = new Date(ms);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};

export function TaskDetailPage() {
    const { id = '' } = useParams();
    const { role, user } = useAuth();
    const qc = useQueryClient();

    const [comment, setComment] = useState('');
    const [reviewNote, setReviewNote] = useState('');
    const [attachmentError, setAttachmentError] = useState('');
    const [now, setNow] = useState(() => Date.now());
    const [statusValue, setStatusValue] = useState<string>('');
    const [newSubtaskLabel, setNewSubtaskLabel] = useState('');
    const [editOpen, setEditOpen] = useState(false);

    // ── Queries ────────────────────────────────────────────────────────────
    const { data: task, isLoading, error } = useQuery({
        queryKey: ['task', id],
        queryFn: () => apiClient.get<any>(`/tasks/${id}`),
        enabled: Boolean(id),
        refetchInterval: 30_000,
    });

    const canEditAll = role === 'LEADER';
    const isAssignee = !!task?.assignees?.some((a: any) => a.user.id === user?.id);

    const { data: members } = useQuery({
        queryKey: ['members'],
        queryFn: () => apiClient.get<any[]>('/members'),
        enabled: canEditAll && editOpen,
    });
    const { data: workstreams } = useQuery({
        queryKey: ['workstreams'],
        queryFn: () => apiClient.get<any[]>('/workstreams'),
        enabled: canEditAll && editOpen,
    });

    // ── Shared clock ───────────────────────────────────────────────────────
    const anyRunning = !!task?.timeEntries?.some((e: any) => !e.endedAt);
    useEffect(() => {
        if (!anyRunning) return;
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [anyRunning]);

    useEffect(() => {
        if (task?.status && task.status !== statusValue) setStatusValue(task.status);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [task?.status]);

    const invalidate = () => {
        void qc.invalidateQueries({ queryKey: ['task', id] });
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        void qc.invalidateQueries({ queryKey: ['board'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
    };

    // ── Mutations ──────────────────────────────────────────────────────────
    const patch = useMutation({
        mutationFn: (body: Record<string, unknown>) => apiClient.patch(`/tasks/${id}`, body),
        onSuccess: invalidate,
    });

    const setStatus = useMutation({
        mutationFn: (status: string) => apiClient.patch(`/tasks/${id}/status`, { status }),
        onSuccess: invalidate,
        onError: () => setStatusValue(task?.status ?? ''),
    });

    const toggleSubtask = useMutation({
        mutationFn: (args: { subtaskId: string; done: boolean }) =>
            apiClient.post(`/tasks/${id}/subtasks/${args.subtaskId}/toggle`, { done: args.done }),
        onSuccess: invalidate,
    });

    const addSubtask = useMutation({
        mutationFn: (label: string) => apiClient.post(`/tasks/${id}/subtasks`, { label }),
        onSuccess: () => { setNewSubtaskLabel(''); invalidate(); },
    });

    const updateSubtask = useMutation({
        mutationFn: (args: { subtaskId: string; label: string }) =>
            apiClient.patch(`/tasks/${id}/subtasks/${args.subtaskId}`, { label: args.label }),
        onSuccess: invalidate,
    });

    const deleteSubtask = useMutation({
        mutationFn: (subtaskId: string) => apiClient.delete(`/tasks/${id}/subtasks/${subtaskId}`),
        onSuccess: invalidate,
    });

    const reorderSubtasks = useMutation({
        mutationFn: (ids: string[]) => apiClient.patch(`/tasks/${id}/subtasks/reorder`, { ids }),
        onSuccess: invalidate,
    });

    const timerMutation = useMutation({
        mutationFn: (action: 'start' | 'pause') => apiClient.post(`/tasks/${id}/timer/${action}`),
        onSuccess: invalidate,
    });

    const review = useMutation({
        mutationFn: (decision: 'approve' | 'request_changes') =>
            apiClient.post(`/tasks/${id}/review`, { decision, note: reviewNote || undefined }),
        onSuccess: () => { setReviewNote(''); invalidate(); },
    });

    const uploadAttachment = useMutation({
        mutationFn: (file: File) => apiClient.upload(`/tasks/${id}/attachments`, file),
        onSuccess: () => { setAttachmentError(''); invalidate(); },
        onError: (err) => setAttachmentError((err as Error).message),
    });

    const addComment = useMutation({
        mutationFn: (body: string) => apiClient.post(`/tasks/${id}/comments`, { body }),
        onSuccess: () => { setComment(''); invalidate(); },
    });

    const remove = useMutation({
        mutationFn: () => apiClient.delete(`/tasks/${id}`),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            window.history.back();
        },
    });

    if (isLoading) return <div className="h-96 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />;
    if (error) return <ErrorState message={(error as Error).message} />;
    if (!task) return null;

    // ── Derived data ───────────────────────────────────────────────────────
    const totalSubtasks = task.subtasks?.length ?? 0;
    const checkedSubtasks = (task.subtasks ?? []).filter((s: any) => s.done).length;
    const progressPct = totalSubtasks === 0 ? 0 : Math.round((checkedSubtasks / totalSubtasks) * 100);

    const perUser: { id: string; name: string; seconds: number; runningSince: number | null }[] = [];
    const rowById = new Map<string, (typeof perUser)[number]>();
    for (const a of task.assignees) {
        const row = { id: a.user.id, name: a.user.name, seconds: 0, runningSince: null as number | null };
        rowById.set(a.user.id, row);
        perUser.push(row);
    }
    for (const e of task.timeEntries) {
        const start = new Date(e.startedAt).getTime();
        const end = e.endedAt ? new Date(e.endedAt).getTime() : now;
        const secs = Math.max(0, Math.floor((end - start) / 1000));
        const row = rowById.get(e.user.id);
        if (!row) continue;
        row.seconds += secs;
        if (!e.endedAt) row.runningSince = start;
    }

    const teamSeconds = perUser.reduce((s, r) => s + r.seconds, 0);
    const loggedHrs = teamSeconds / 3600;
    const isOverEstimate = !!task.estimatedHrs && loggedHrs > task.estimatedHrs;

    const renameSubtask = (subtask: { id: string; label: string }) => {
        const label = window.prompt('Rename subtask', subtask.label);
        if (label !== null && label.trim() && label.trim() !== subtask.label) {
            updateSubtask.mutate({ subtaskId: subtask.id, label: label.trim() });
        }
    };
    const moveSubtask = (index: number, direction: -1 | 1) => {
        const ids = task.subtasks.map((s: any) => s.id);
        const [moved] = ids.splice(index, 1);
        ids.splice(index + direction, 0, moved);
        reorderSubtasks.mutate(ids);
    };

    const links: string[] = task.links ?? [];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            {/* ─────────────────────── Header ─────────────────────── */}
            <header className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-500">Task #{task.reference}</p>
                    <h1 className="mt-1 text-2xl font-semibold">{task.title}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={task.status} />
                        <span className="inline-flex items-center gap-1.5 text-sm">
                            <PriorityDot priority={task.priority} /> {task.priority}
                        </span>
                    </div>
                </div>

                {(canEditAll || isAssignee) && (
                    <select
                        value={statusValue || task.status}
                        onChange={(e) => {
                            const next = e.target.value;
                            setStatusValue(next);
                            setStatus.mutate(next);
                        }}
                        disabled={setStatus.isPending}
                        className={`${input} w-44`}
                    >
                        {STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {s.replace('_', ' ')}
                            </option>
                        ))}
                    </select>
                )}

                {canEditAll && (
                    <div className="flex gap-2">
                        <button onClick={() => setEditOpen(true)} className={btnSecondary}>
                            Edit
                        </button>
                        <button
                            onClick={() => patch.mutate({ isArchived: !task.isArchived })}
                            className={btnSecondary}
                        >
                            {task.isArchived ? 'Restore' : 'Archive'}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm('Delete permanently?')) remove.mutate();
                            }}
                            className={btnDanger}
                        >
                            Delete
                        </button>
                    </div>
                )}
            </header>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* ─────────────────────── Main column ─────────────────────── */}
                <section className="space-y-6 lg:col-span-2">
                    {/* Description */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Description</h2>
                        {task.description
                            ? <MarkdownRenderer content={task.description} />
                            : <p className="text-sm text-slate-400">No description.</p>}
                    </div>

                    {/* Subtasks */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h2 className="font-semibold">
                                Subtasks
                                <span className="ml-2 text-sm font-normal text-slate-500">
                                    {checkedSubtasks}/{totalSubtasks} · {progressPct}%
                                </span>
                            </h2>
                            <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                    className="h-full bg-[#2563EB] transition-all"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                        </div>

                        {totalSubtasks === 0 ? (
                            <p className="text-sm text-slate-500">No subtasks yet.</p>
                        ) : (
                            <ul className="space-y-1">
                                {task.subtasks.map((s: any, index: number) => (
                                    <li key={s.id} className="flex items-center gap-2 rounded px-1 py-1">
                                        <input
                                            type="checkbox"
                                            checked={s.done}
                                            onChange={(e) =>
                                                toggleSubtask.mutate({ subtaskId: s.id, done: e.target.checked })
                                            }
                                            disabled={toggleSubtask.isPending}
                                            className="size-4 accent-[#2563EB]"
                                        />
                                        <span
                                            className={`min-w-0 flex-1 text-sm ${s.done ? 'line-through text-slate-400' : ''
                                                }`}
                                        >
                                            {s.label}
                                        </span>
                                        {s.done && s.doneBy && (
                                            <span className="text-xs text-slate-400">
                                                {s.doneBy.name}
                                                {s.doneAt ? ` · ${new Date(s.doneAt).toLocaleString()}` : ''}
                                            </span>
                                        )}
                                        {canEditAll && (
                                            <div className="flex items-center gap-0.5">
                                                <button
                                                    onClick={() => moveSubtask(index, -1)}
                                                    disabled={index === 0}
                                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800"
                                                    aria-label="Move up"
                                                >
                                                    <ArrowUp className="size-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => moveSubtask(index, 1)}
                                                    disabled={index === task.subtasks.length - 1}
                                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800"
                                                    aria-label="Move down"
                                                >
                                                    <ArrowDown className="size-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => renameSubtask(s)}
                                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"
                                                    aria-label="Rename"
                                                >
                                                    <Pencil className="size-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => deleteSubtask.mutate(s.id)}
                                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                                                    aria-label="Delete"
                                                >
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}

                        {canEditAll && (
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    const label = newSubtaskLabel.trim();
                                    if (label) addSubtask.mutate(label);
                                }}
                                className="mt-3 flex gap-2"
                            >
                                <input
                                    value={newSubtaskLabel}
                                    onChange={(e) => setNewSubtaskLabel(e.target.value)}
                                    placeholder="New subtask…"
                                    className={input}
                                />
                                <button
                                    type="submit"
                                    disabled={!newSubtaskLabel.trim() || addSubtask.isPending}
                                    className={btnSecondary}
                                    aria-label="Add subtask"
                                >
                                    <Plus className="size-4" />
                                </button>
                            </form>
                        )}
                    </div>

                    {/* Team timer panel */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-4 flex items-center gap-2">
                            <Users className="size-4 text-slate-500" />
                            <h2 className="font-semibold">Team time tracking</h2>
                        </div>

                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                            {perUser.length === 0 && (
                                <li className="py-2 text-sm text-slate-500">No assignees.</li>
                            )}
                            {perUser.map((r) => {
                                const isMe = r.id === user?.id;
                                const running = r.runningSince !== null;
                                return (
                                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                                        <span className="min-w-0 truncate font-medium">
                                            {r.name}
                                            {isMe && <span className="ml-1 text-xs text-slate-400">(you)</span>}
                                        </span>
                                        <div className="flex items-center gap-3 tabular-nums">
                                            <span
                                                className={
                                                    running
                                                        ? 'font-medium text-emerald-600'
                                                        : 'text-slate-500'
                                                }
                                            >
                                                {running
                                                    ? `Running since ${formatHHMM(r.runningSince!)}`
                                                    : 'Paused'}
                                            </span>
                                            <span className="w-24 text-right font-semibold">
                                                {formatTime(r.seconds)}
                                            </span>
                                            <span className="w-16 text-right text-xs text-slate-500">
                                                {(r.seconds / 3600).toFixed(2)}h
                                            </span>
                                            {isMe && isAssignee && (
                                                running ? (
                                                    <button
                                                        onClick={() => timerMutation.mutate('pause')}
                                                        disabled={timerMutation.isPending}
                                                        className="flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50"
                                                    >
                                                        <Pause className="size-3.5" /> Pause
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => timerMutation.mutate('start')}
                                                        disabled={timerMutation.isPending}
                                                        className="flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                                                    >
                                                        <Play className="size-3.5" />
                                                        {r.seconds > 0 ? 'Resume' : 'Start'}
                                                    </button>
                                                )
                                            )}
                                            {!isMe && <span className="w-20" />}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
                            <span className="font-medium">
                                Team total: {formatTime(teamSeconds)} · {loggedHrs.toFixed(2)}h
                                {task.estimatedHrs != null && (
                                    <span className="ml-1 text-slate-500">/ {task.estimatedHrs}h estimated</span>
                                )}
                            </span>
                            {isOverEstimate && (
                                <span className="flex items-center gap-1 font-medium text-red-600">
                                    <AlertTriangle className="size-4" /> Over estimate
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Review */}
                    {canEditAll && task.status === 'IN_REVIEW' && (
                        <div className="rounded-xl border border-[#FCA840]/40 bg-[#FCA840]/5 p-5">
                            <h2 className="mb-3 font-semibold">This task is awaiting your review</h2>
                            <textarea
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                                rows={2}
                                placeholder="Optional note for the assignee…"
                                className={input}
                            />
                            <div className="mt-3 flex gap-2">
                                <button
                                    onClick={() => review.mutate('approve')}
                                    className={btnPrimary}
                                    disabled={review.isPending}
                                >
                                    Approve completion
                                </button>
                                <button
                                    onClick={() => review.mutate('request_changes')}
                                    className={btnSecondary}
                                    disabled={review.isPending}
                                >
                                    Request changes
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Links */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 flex items-center gap-2 font-semibold">
                            <LinkIcon className="size-4" /> Relevant Links
                        </h2>
                        {links.length === 0 ? (
                            <p className="text-sm text-slate-400">No links added yet.</p>
                        ) : (
                            <ul className="space-y-2">
                                {links.map((link, i) => (
                                    <li
                                        key={i}
                                        className="flex items-center gap-2 rounded bg-slate-50 p-2 text-sm dark:bg-slate-800"
                                    >
                                        <a
                                            href={link}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="truncate text-[#2563EB] hover:underline"
                                        >
                                            {link}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {canEditAll && (
                            <p className="mt-3 text-xs text-slate-500">
                                Add or remove links via the Edit form.
                            </p>
                        )}
                    </div>

                    {/* Attachments */}
                    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Paperclip className="size-4 text-slate-500" />
                                <h2 className="font-semibold">
                                    Files and images ({task.attachments?.length ?? 0})
                                </h2>
                            </div>
                            <label
                                className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 ${uploadAttachment.isPending ? 'pointer-events-none opacity-50' : ''
                                    }`}
                            >
                                <Upload className="size-4" />{' '}
                                {uploadAttachment.isPending ? 'Uploading…' : 'Upload file'}
                                <input
                                    type="file"
                                    className="sr-only"
                                    disabled={uploadAttachment.isPending}
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) uploadAttachment.mutate(file);
                                        event.currentTarget.value = '';
                                    }}
                                />
                            </label>
                        </div>
                        {attachmentError && (
                            <p className="mb-3 text-sm text-red-600">{attachmentError}</p>
                        )}
                        {task.attachments?.length ? (
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                {task.attachments.map((file: any) => (
                                    <li key={file.id} className="flex items-center gap-3 py-2.5">
                                        {file.mimeType.startsWith('image/') ? (
                                            <span className="grid size-9 place-items-center rounded bg-blue-50 text-xs text-blue-700">
                                                IMG
                                            </span>
                                        ) : (
                                            <Paperclip className="ms-2 size-4 text-slate-400" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{file.fileName}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const result = await apiClient.get<any>(
                                                        `/tasks/${id}/attachments/${file.id}/download`,
                                                    );
                                                    if (result.url) {
                                                        window.open(result.url, '_blank', 'noopener,noreferrer');
                                                        return;
                                                    }
                                                    const bytes = Uint8Array.from(atob(result.content), (c) =>
                                                        c.charCodeAt(0),
                                                    );
                                                    const objectUrl = URL.createObjectURL(
                                                        new Blob([bytes], { type: file.mimeType }),
                                                    );
                                                    const anchor = document.createElement('a');
                                                    anchor.href = objectUrl;
                                                    anchor.download = file.fileName;
                                                    anchor.click();
                                                    URL.revokeObjectURL(objectUrl);
                                                } catch (err) {
                                                    setAttachmentError((err as Error).message);
                                                }
                                            }}
                                            className="rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                        >
                                            <Download className="size-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-slate-500">No files uploaded.</p>
                        )}
                    </section>
                </section>

                {/* ─────────────────────── Sidebar ─────────────────────── */}
                {/* Sticky on large screens so it stays put while main column scrolls. */}
                <aside className="space-y-6 lg:sticky lg:top-4 lg:self-start">
                    {/* Details */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Details</h2>
                        <dl className="space-y-3 text-sm">
                            <div>
                                <dt className="text-slate-500">Assignees</dt>
                                <dd className="mt-1">
                                    {task.assignees.length ? (
                                        task.assignees.map((a: any) => (
                                            <span key={a.user.id} className="mr-2 inline-block">
                                                {a.user.name}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-[#b45309]">Unassigned</span>
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Start date</dt>
                                <dd>{task.startDate ? new Date(task.startDate).toLocaleDateString() : '—'}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Deadline</dt>
                                <dd>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Estimated hours</dt>
                                <dd>{task.estimatedHrs ?? '—'}</dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Logged hours (team)</dt>
                                <dd>{loggedHrs.toFixed(2)}</dd>
                            </div>
                            {task.tags?.length > 0 && (
                                <div>
                                    <dt className="text-slate-500">Tags</dt>
                                    <dd className="mt-1 flex flex-wrap gap-1">
                                        {task.tags.map((t: any) => (
                                            <span
                                                key={t.tag.id}
                                                className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800"
                                            >
                                                {t.tag.name}
                                            </span>
                                        ))}
                                    </dd>
                                </div>
                            )}
                        </dl>
                    </div>

                    {/* Comments — placed above Activity so events never push it down. */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 flex items-center gap-2 font-semibold">
                            <MessageSquare className="size-4 text-slate-500" />
                            Comments ({task.comments?.length ?? 0})
                        </h2>

                        {/* Scrollable comment list — grows independently. */}
                        <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
                            {task.comments?.length ? (
                                task.comments.map((c: any) => (
                                    <div key={c.id} className="flex gap-3">
                                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2563EB] text-xs font-semibold text-white">
                                            {c.author.name.charAt(0).toUpperCase()}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm">
                                                <span className="font-medium">{c.author.name}</span>
                                                <span className="ml-2 text-xs text-slate-400">
                                                    {new Date(c.createdAt).toLocaleString()}
                                                </span>
                                            </p>
                                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-400">
                                                {c.body}
                                            </p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-sm text-slate-400">No comments yet.</p>
                            )}
                        </div>

                        {/* Comment input always visible below the list. */}
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (comment.trim()) addComment.mutate(comment.trim());
                            }}
                            className="mt-3 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"
                        >
                            <input
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Write a comment..."
                                className={input}
                            />
                            <button
                                type="submit"
                                disabled={!comment.trim() || addComment.isPending}
                                className={btnPrimary}
                            >
                                Send
                            </button>
                        </form>
                    </div>

                    {/* Activity — own scroll area, doesn't push the comment card. */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Activity</h2>
                        <ul className="max-h-72 space-y-3 overflow-y-auto pr-1 text-xs">
                            {task.activities?.length ? (
                                task.activities.map((a: any) => (
                                    <li key={a.id} className="text-slate-600 dark:text-slate-400">
                                        <span className="font-medium text-slate-900 dark:text-slate-100">
                                            {a.actor.name}
                                        </span>{' '}
                                        {a.summary}
                                        <span className="ml-1 text-slate-400">
                                            {new Date(a.createdAt).toLocaleString()}
                                        </span>
                                    </li>
                                ))
                            ) : (
                                <li className="text-slate-400">No activity yet.</li>
                            )}
                        </ul>
                    </div>
                </aside>
            </div>

            {/* ─────────────────────── Edit form (leader only) ─────────────────────── */}
            {canEditAll && editOpen && (
                <EditTaskModal
                    task={task}
                    members={members ?? []}
                    workstreams={workstreams ?? []}
                    onClose={() => setEditOpen(false)}
                    onSave={(payload) => patch.mutate(payload, { onSuccess: () => setEditOpen(false) })}
                    isSaving={patch.isPending}
                />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit form modal
// ─────────────────────────────────────────────────────────────────────────────

function EditTaskModal({
    task,
    members,
    workstreams,
    onClose,
    onSave,
    isSaving,
}: {
    task: any;
    members: any[];
    workstreams: any[];
    onClose: () => void;
    onSave: (payload: Record<string, unknown>) => void;
    isSaving: boolean;
}) {
    const [form, setForm] = useState({
        title: task.title ?? '',
        description: task.description ?? '',
        priority: task.priority ?? 'MEDIUM',
        startDate: task.startDate ? task.startDate.slice(0, 10) : '',
        dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
        estimatedHrs: task.estimatedHrs ?? '',
        workstreamId: task.workstreamId ?? '',
        tagNames: (task.tags ?? []).map((t: any) => t.tag.name).join(', '),
        links: (task.links ?? []).join(', '),
        assigneeIds: (task.assignees ?? []).map((a: any) => a.user.id),
        isArchived: !!task.isArchived,
    });

    const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            title: form.title.trim(),
            description: form.description,
            priority: form.priority,
            startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
            dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
            estimatedHrs:
                form.estimatedHrs === '' || form.estimatedHrs == null
                    ? null
                    : Number(form.estimatedHrs),
            workstreamId: form.workstreamId || null,
            tagNames: form.tagNames.split(',').map((s) => s.trim()).filter(Boolean),
            links: form.links.split(',').map((s) => s.trim()).filter(Boolean),
            assigneeIds: form.assigneeIds,
            isArchived: form.isArchived,
        });
    };

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
            <form
                onSubmit={handleSubmit}
                className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Edit task</h2>
                    <button type="button" onClick={onClose} aria-label="Close">
                        <X className="size-5" />
                    </button>
                </div>

                <div className="space-y-4">
                    <Field label="Title">
                        <input
                            value={form.title}
                            onChange={(e) => update('title', e.target.value)}
                            className={input}
                            required
                            minLength={2}
                            maxLength={200}
                        />
                    </Field>

                    <Field label="Description">
                        <MarkdownEditor
                            value={form.description}
                            onChange={(val) => update('description', val)}
                        />
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Priority">
                            <select
                                value={form.priority}
                                onChange={(e) => update('priority', e.target.value)}
                                className={input}
                            >
                                {PRIORITIES.map((p) => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label="Workstream">
                            <select
                                value={form.workstreamId}
                                onChange={(e) => update('workstreamId', e.target.value)}
                                className={input}
                            >
                                <option value="">— None —</option>
                                {workstreams.map((w) => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <Field label="Start date">
                            <input
                                type="date"
                                value={form.startDate}
                                onChange={(e) => update('startDate', e.target.value)}
                                className={input}
                            />
                        </Field>
                        <Field label="Due date">
                            <input
                                type="date"
                                value={form.dueDate}
                                onChange={(e) => update('dueDate', e.target.value)}
                                className={input}
                            />
                        </Field>
                        <Field label="Estimated hours">
                            <input
                                type="number"
                                step="0.5"
                                min="0"
                                value={form.estimatedHrs as any}
                                onChange={(e) => update('estimatedHrs', e.target.value as any)}
                                className={input}
                            />
                        </Field>
                    </div>

                    <Field label="Assignees" hint="Ctrl/Cmd-click for multi-select">
                        <select
                            multiple
                            value={form.assigneeIds}
                            onChange={(e) =>
                                update(
                                    'assigneeIds',
                                    Array.from(e.target.selectedOptions, (o) => o.value),
                                )
                            }
                            className={`${input} h-32`}
                        >
                            {members.map((m) => (
                                <option key={m.user.id} value={m.user.id}>
                                    {m.user.name}
                                </option>
                            ))}
                        </select>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Tags" hint="Comma separated">
                            <input
                                value={form.tagNames}
                                onChange={(e) => update('tagNames', e.target.value)}
                                className={input}
                            />
                        </Field>
                        <Field label="Links" hint="Comma separated URLs">
                            <input
                                value={form.links}
                                onChange={(e) => update('links', e.target.value)}
                                className={input}
                            />
                        </Field>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={form.isArchived}
                            onChange={(e) => update('isArchived', e.target.checked)}
                        />
                        Archived
                    </label>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className={btnSecondary}>
                        Cancel
                    </button>
                    <button type="submit" disabled={isSaving} className={btnPrimary}>
                        {isSaving ? 'Saving…' : 'Save changes'}
                    </button>
                </div>
            </form>
        </div>
    );
}









// import { useState, useEffect, useMemo } from 'react';
// import { useParams } from 'react-router-dom';
// import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
// import { apiClient } from '../lib/api';
// import { useAuth } from '../lib/auth';
// import { btnPrimary, btnSecondary, btnDanger, input } from '../components/QuickCreateTask';
// import { ErrorState, PriorityDot, StatusBadge } from './Dashboard';
// import { Download, Paperclip, Upload, Play, Pause, Clock, Link as LinkIcon, Plus, AlertTriangle, Users } from 'lucide-react';
// import { MarkdownEditor } from '../components/MarkdownEditor';
// import { MarkdownRenderer } from '../components/MarkdownRenderer';

// const formatTime = (totalSecs: number) => {
//     const h = Math.floor(totalSecs / 3600);
//     const m = Math.floor((totalSecs % 3600) / 60);
//     const s = totalSecs % 60;
//     return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
// };

// export function TaskDetailPage() {
//     const { id = '' } = useParams();
//     const { role, user } = useAuth();
//     const qc = useQueryClient();
//     const [comment, setComment] = useState('');
//     const [reviewNote, setReviewNote] = useState('');
//     const [attachmentError, setAttachmentError] = useState('');
//     const [newLink, setNewLink] = useState('');
//     const [now, setNow] = useState(() => Date.now());

//     // حالة تعديل الوصف
//     const [isEditingDesc, setIsEditingDesc] = useState(false);
//     const [descValue, setDescValue] = useState('');

//     const { data: task, isLoading, error } = useQuery({
//         queryKey: ['task', id],
//         queryFn: () => apiClient.get<any>(`/tasks/${id}`),
//         enabled: Boolean(id),
//         refetchInterval: 10_000,
//     });

//     const invalidate = () => {
//         void qc.invalidateQueries({ queryKey: ['task', id] });
//         void qc.invalidateQueries({ queryKey: ['tasks'] });
//         void qc.invalidateQueries({ queryKey: ['board'] });
//         void qc.invalidateQueries({ queryKey: ['dashboard'] });
//     };

//     const patch = useMutation({
//         mutationFn: (body: Record<string, unknown>) => apiClient.patch(`/tasks/${id}`, body),
//         onSuccess: invalidate,
//     });

//     // ================= Timer Logic =================
//     // Every entry on the task, from every person. The server returns all of them.
//     const timeEntries: any[] = task?.timeEntries ?? [];
//     const hasOpenEntry = timeEntries.some((e: any) => !e.endedAt);

//     // One clock drives every running entry, so the display stays live for everyone.
//     useEffect(() => {
//         if (!hasOpenEntry) return;
//         setNow(Date.now());
//         const interval = setInterval(() => setNow(Date.now()), 1000);
//         return () => clearInterval(interval);
//     }, [hasOpenEntry]);

//     // An entry counts from its start to its end, or to "now" while it is still open.
//     const entrySeconds = (e: any) => {
//         const start = new Date(e.startedAt).getTime();
//         const end = e.endedAt ? new Date(e.endedAt).getTime() : now;
//         return Math.max(0, Math.floor((end - start) / 1000));
//     };

//     // Totals per person. Each resume adds a new entry, so the total continues from the last pause.
//     const perUser = useMemo(() => {
//         const map = new Map<string, { id: string; name: string; seconds: number; running: boolean }>();
//         for (const e of timeEntries) {
//             const key: string = e.user.id;
//             const row = map.get(key) ?? { id: key, name: e.user.name, seconds: 0, running: false };
//             row.seconds += entrySeconds(e);
//             if (!e.endedAt) row.running = true;
//             map.set(key, row);
//         }
//         return Array.from(map.values());
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//     }, [timeEntries, now]);

//     const teamSeconds = perUser.reduce((sum, r) => sum + r.seconds, 0);
//     const mySeconds = perUser.find((r) => r.id === user?.id)?.seconds ?? 0;
//     const openEntry = timeEntries.find((e: any) => e.user.id === user?.id && !e.endedAt);
//     const isTracking = !!openEntry;

//     // تحديث الوصف عند تحميل المهمة لأول مرة
//     useEffect(() => {
//         if (task?.description && !isEditingDesc) {
//             setDescValue(task.description);
//         }
//     }, [task?.description, isEditingDesc]);

//     const timerMutation = useMutation({
//         mutationFn: (action: 'pause' | 'resume') =>
//             action === 'pause'
//                 ? apiClient.post(`/tasks/${id}/timer/pause`)
//                 : apiClient.post(`/tasks/${id}/timer/start`),
//         onSuccess: invalidate,
//     });

//     // Total logged across the whole team, in hours.
//     const loggedHrs = teamSeconds / 3600;
//     const isOverEstimate = !!task?.estimatedHrs && loggedHrs > task.estimatedHrs;

//     // ================= Review & Links =================
//     const review = useMutation({
//         mutationFn: (decision: 'approve' | 'request_changes') =>
//             apiClient.post(`/tasks/${id}/review`, { decision, note: reviewNote || undefined }),
//         onSuccess: () => { setReviewNote(''); invalidate(); },
//     });

//     const addLink = () => {
//         if (!newLink.trim()) return;
//         patch.mutate({ links: [...(task.links || []), newLink.trim()] });
//         setNewLink('');
//     };

//     const removeLink = (linkToRemove: string) => {
//         patch.mutate({ links: (task.links || []).filter((l: string) => l !== linkToRemove) });
//     };

//     const uploadAttachment = useMutation({
//         mutationFn: (file: File) => apiClient.upload(`/tasks/${id}/attachments`, file),
//         onSuccess: () => { setAttachmentError(''); invalidate(); },
//         onError: (err) => setAttachmentError((err as Error).message),
//     });

//     const addComment = useMutation({
//         mutationFn: (body: string) => apiClient.post(`/tasks/${id}/comments`, { body }),
//         onSuccess: () => { setComment(''); invalidate(); },
//     });

//     const remove = useMutation({
//         mutationFn: () => apiClient.delete(`/tasks/${id}`),
//         onSuccess: () => {
//             void qc.invalidateQueries({ queryKey: ['tasks'] });
//             window.history.back();
//         },
//     });

//     if (isLoading) return <div className="h-96 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />;
//     if (error) return <ErrorState message={(error as Error).message} />;
//     if (!task) return null;

//     const canEditAll = role === 'LEADER';
//     const isAssignee = task.assignees.some((a: any) => a.user.id === user?.id);
//     const canTrackTime = isAssignee || canEditAll;

//     // The leader sees every person's time. An assignee sees only their own row.
//     const visibleRows = canEditAll ? perUser : perUser.filter((r) => r.id === user?.id);

//     return (
//         <div className="mx-auto max-w-4xl space-y-6">
//             <header className="flex flex-wrap items-start gap-3">
//                 <div className="min-w-0 flex-1">
//                     <p className="text-sm text-slate-500">Task #{task.reference}</p>
//                     <h1 className="mt-1 text-2xl font-semibold">{task.title}</h1>
//                     <div className="mt-2 flex flex-wrap items-center gap-2">
//                         <StatusBadge status={task.status} />
//                         <span className="inline-flex items-center gap-1.5 text-sm">
//                             <PriorityDot priority={task.priority} /> {task.priority}
//                         </span>
//                     </div>
//                 </div>

//                 {canEditAll && (
//                     <div className="flex gap-2">
//                         <button onClick={() => patch.mutate({ isArchived: !task.isArchived })} className={btnSecondary}>
//                             {task.isArchived ? 'Restore' : 'Archive'}
//                         </button>
//                         <button onClick={() => { if (confirm('Delete permanently?')) remove.mutate(); }} className={btnDanger}>
//                             Delete
//                         </button>
//                     </div>
//                 )}
//             </header>

//             <div className="grid gap-6 lg:grid-cols-3">
//                 <section className="space-y-6 lg:col-span-2">
//                     {/* Description */}
//                     <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
//                         <div className="mb-3 flex items-center justify-between">
//                             <h2 className="font-semibold">Description</h2>
//                             {!isEditingDesc && canTrackTime && (
//                                 <button onClick={() => { setDescValue(task.description || ''); setIsEditingDesc(true); }} className="text-sm text-[#2563EB] hover:underline">
//                                     Edit
//                                 </button>
//                             )}
//                         </div>

//                         {isEditingDesc ? (
//                             <div className="space-y-3">
//                                 <MarkdownEditor value={descValue} onChange={setDescValue} />
//                                 <div className="flex justify-end gap-2">
//                                     <button onClick={() => setIsEditingDesc(false)} className={btnSecondary}>Cancel</button>
//                                     <button onClick={() => patch.mutate({ description: descValue }, { onSuccess: () => setIsEditingDesc(false) })} className={btnPrimary} disabled={patch.isPending}>Save</button>
//                                 </div>
//                             </div>
//                         ) : (
//                             <MarkdownRenderer content={task.description} />
//                         )}
//                     </div>

//                     {/* Timer & Progress */}
//                     {canTrackTime && (
//                         <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
//                             <h2 className="mb-4 font-semibold">Progress & Time Tracking</h2>

//                             {task.status === 'IN_PROGRESS' && (
//                                 <div className={`mb-6 flex flex-col gap-3 rounded-lg p-4 ${isOverEstimate ? 'bg-red-50 border border-red-200 dark:bg-red-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
//                                     <div className="flex items-center justify-between">
//                                         <div className="flex items-center gap-3">
//                                             <Clock className={`size-5 ${isOverEstimate ? 'text-red-500' : 'text-[#2563EB]'}`} />
//                                             <div>
//                                                 <p className={`text-sm font-medium ${isOverEstimate ? 'text-red-700 dark:text-red-400' : 'text-[#1D4ED8] dark:text-blue-300'}`}>
//                                                     {isTracking ? 'Time Tracking Active' : 'Timer Paused'}
//                                                 </p>
//                                                 <p className="text-2xl font-bold tabular-nums">
//                                                     {formatTime(mySeconds)}
//                                                 </p>
//                                                 <p className="text-xs text-slate-500">Your time on this task</p>
//                                             </div>
//                                         </div>
//                                         {isAssignee || canEditAll ? (
//                                             isTracking ? (
//                                                 <button onClick={() => timerMutation.mutate('pause')} disabled={timerMutation.isPending} className="flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-200">
//                                                     <Pause className="size-4" /> Pause
//                                                 </button>
//                                             ) : (
//                                                 <button onClick={() => timerMutation.mutate('resume')} disabled={timerMutation.isPending} className="flex items-center gap-2 rounded-lg bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-200">
//                                                     <Play className="size-4" /> {mySeconds > 0 ? 'Resume' : 'Start'}
//                                                 </button>
//                                             )
//                                         ) : null}
//                                     </div>

//                                     {isOverEstimate && (
//                                         <div className="flex items-center gap-2 text-sm text-red-600 font-medium">
//                                             <AlertTriangle className="size-4" />
//                                             Warning: Logged hours exceeded estimated hours ({task.estimatedHrs}h)!
//                                         </div>
//                                     )}
//                                 </div>
//                             )}

//                             {/* Team time: every assignee's total and running state */}
//                             {visibleRows.length > 0 && (
//                                 <div className="mb-6 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
//                                     <div className="mb-3 flex items-center gap-2 text-sm font-medium">
//                                         <Users className="size-4 text-slate-500" />
//                                         {canEditAll ? 'Time by person' : 'Your time'}
//                                     </div>
//                                     <ul className="divide-y divide-slate-100 dark:divide-slate-800">
//                                         {visibleRows.map((r) => (
//                                             <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
//                                                 <span className="min-w-0 truncate font-medium">{r.name}</span>
//                                                 <span className="flex items-center gap-3 tabular-nums">
//                                                     <span className={r.running ? 'font-semibold text-emerald-600' : 'text-slate-500'}>
//                                                         {r.running ? 'Running' : 'Paused'}
//                                                     </span>
//                                                     <span className="font-semibold">{formatTime(r.seconds)}</span>
//                                                 </span>
//                                             </li>
//                                         ))}
//                                     </ul>
//                                 </div>
//                             )}

//                             <div className="space-y-4">
//                                 <label className="block">
//                                     <span className="mb-2 flex justify-between text-sm font-medium">
//                                         <span>Progress</span>
//                                         <span>{task.progress}%</span>
//                                     </span>
//                                     <input
//                                         type="range" min={0} max={100} step={5} defaultValue={task.progress}
//                                         onMouseUp={(e) => patch.mutate({ progress: Number((e.target as HTMLInputElement).value) })}
//                                         onTouchEnd={(e) => patch.mutate({ progress: Number((e.target as HTMLInputElement).value) })}
//                                         className="w-full accent-[#2563EB]"
//                                     />
//                                 </label>
//                                 <div className="flex justify-between text-sm text-slate-500">
//                                     <span>Logged (team): {loggedHrs.toFixed(2)}h</span>
//                                     <span>Estimated: {task.estimatedHrs ?? '—'}h</span>
//                                 </div>
//                             </div>
//                         </div>
//                     )}

//                     {/* Review Actions */}
//                     {canEditAll && task.status === 'IN_REVIEW' && (
//                         <div className="rounded-xl border border-[#FCA840]/40 bg-[#FCA840]/5 p-5">
//                             <h2 className="mb-3 font-semibold">This task is awaiting your review</h2>
//                             <textarea
//                                 value={reviewNote}
//                                 onChange={(e) => setReviewNote(e.target.value)}
//                                 rows={2}
//                                 placeholder="Optional note for the assignee…"
//                                 className={input}
//                             />
//                             <div className="mt-3 flex gap-2">
//                                 <button onClick={() => review.mutate('approve')} className={btnPrimary}>
//                                     Approve completion
//                                 </button>
//                                 <button onClick={() => review.mutate('request_changes')} className={btnSecondary}>
//                                     Request changes
//                                 </button>
//                             </div>
//                         </div>
//                     )}

//                     {/* Links Section */}
//                     <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
//                         <h2 className="mb-3 flex items-center gap-2 font-semibold"><LinkIcon className="size-4" /> Relevant Links</h2>
//                         <ul className="space-y-2 mb-4">
//                             {(task.links || []).map((link: string, i: number) => (
//                                 <li key={i} className="flex items-center justify-between gap-2 rounded bg-slate-50 p-2 text-sm dark:bg-slate-800">
//                                     <a href={link} target="_blank" rel="noreferrer" className="text-[#2563EB] hover:underline truncate">
//                                         {link}
//                                     </a>
//                                     {canTrackTime && (
//                                         <button onClick={() => removeLink(link)} className="text-red-500 hover:text-red-700 text-xs">Remove</button>
//                                     )}
//                                 </li>
//                             ))}
//                             {(task.links || []).length === 0 && <p className="text-sm text-slate-400">No links added yet.</p>}
//                         </ul>

//                         {canTrackTime && (
//                             <div className="flex gap-2">
//                                 <input
//                                     value={newLink}
//                                     onChange={(e) => setNewLink(e.target.value)}
//                                     placeholder="https://example.com"
//                                     className={input}
//                                 />
//                                 <button onClick={addLink} disabled={!newLink.trim()} className={btnSecondary}>
//                                     <Plus className="size-4" />
//                                 </button>
//                             </div>
//                         )}
//                     </div>

//                     {/* Files & Images */}
//                     <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
//                         <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
//                             <div className="flex items-center gap-2">
//                                 <Paperclip className="size-4 text-slate-500" />
//                                 <h2 className="font-semibold">Files and images ({task.attachments?.length ?? 0})</h2>
//                             </div>
//                             <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 ${uploadAttachment.isPending ? 'pointer-events-none opacity-50' : ''}`}>
//                                 <Upload className="size-4" /> {uploadAttachment.isPending ? 'Uploading…' : 'Upload file'}
//                                 <input type="file" className="sr-only" disabled={uploadAttachment.isPending} onChange={(event) => {
//                                     const file = event.target.files?.[0];
//                                     if (file) uploadAttachment.mutate(file);
//                                     event.currentTarget.value = '';
//                                 }} />
//                             </label>
//                         </div>
//                         {attachmentError && <p className="mb-3 text-sm text-red-600">{attachmentError}</p>}
//                         {task.attachments?.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">
//                             {task.attachments.map((file: any) => <li key={file.id} className="flex items-center gap-3 py-2.5">
//                                 {file.mimeType.startsWith('image/') ? <span className="grid size-9 place-items-center rounded bg-blue-50 text-xs text-blue-700">IMG</span> : <Paperclip className="ms-2 size-4 text-slate-400" />}
//                                 <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.fileName}</p></div>
//                                 <button type="button" onClick={async () => {
//                                     try {
//                                         const result = await apiClient.get<any>(`/tasks/${id}/attachments/${file.id}/download`);
//                                         if (result.url) { window.open(result.url, '_blank', 'noopener,noreferrer'); return; }
//                                         const bytes = Uint8Array.from(atob(result.content), (char) => char.charCodeAt(0));
//                                         const objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
//                                         const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = file.fileName; anchor.click(); URL.revokeObjectURL(objectUrl);
//                                     } catch (err) { setAttachmentError((err as Error).message); }
//                                 }} className="rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Download className="size-4" /></button>
//                             </li>)}
//                         </ul> : <p className="text-sm text-slate-500">No files uploaded.</p>}
//                     </section>
//                 </section>

//                 {/* Sidebar: Details & Activity */}
//                 <aside className="space-y-6">
//                     <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
//                         <h2 className="mb-3 font-semibold">Details</h2>
//                         <dl className="space-y-3 text-sm">
//                             <div>
//                                 <dt className="text-slate-500">Assignees</dt>
//                                 <dd className="mt-1">
//                                     {task.assignees.length
//                                         ? task.assignees.map((a: any) => <span key={a.user.id} className="mr-2 inline-block">{a.user.name}</span>)
//                                         : <span className="text-[#b45309]">Unassigned</span>}
//                                 </dd>
//                             </div>
//                             <div>
//                                 <dt className="text-slate-500">Deadline</dt>
//                                 <dd>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}</dd>
//                             </div>
//                             <div>
//                                 <dt className="text-slate-500">Estimated hours</dt>
//                                 <dd>{task.estimatedHrs ?? '—'}</dd>
//                             </div>
//                             <div>
//                                 <dt className="text-slate-500">Logged hours (team)</dt>
//                                 <dd>{loggedHrs.toFixed(2)}</dd>
//                             </div>
//                         </dl>
//                     </div>

//                     <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
//                         <h2 className="mb-3 font-semibold">Activity</h2>
//                         <ul className="space-y-3 text-xs">
//                             {task.activities.map((a: any) => (
//                                 <li key={a.id} className="text-slate-600 dark:text-slate-400">
//                                     <span className="font-medium text-slate-900 dark:text-slate-100">{a.actor.name}</span>{' '}
//                                     {a.summary}
//                                     <span className="ml-1 text-slate-400">{new Date(a.createdAt).toLocaleString()}</span>
//                                 </li>
//                             ))}
//                         </ul>
//                     </div>
//                 </aside>
//             </div>

//             {/* Comments Section */}
//             <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
//                 <h2 className="mb-4 font-semibold">Comments ({task.comments.length})</h2>
//                 <div className="space-y-4">
//                     {task.comments.map((c: any) => (
//                         <div key={c.id} className="flex gap-3">
//                             <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2563EB] text-xs font-semibold text-white">
//                                 {c.author.name.charAt(0).toUpperCase()}
//                             </span>
//                             <div className="min-w-0 flex-1">
//                                 <p className="text-sm">
//                                     <span className="font-medium">{c.author.name}</span>
//                                     <span className="ml-2 text-xs text-slate-400">{new Date(c.createdAt).toLocaleString()}</span>
//                                 </p>
//                                 <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{c.body}</p>
//                             </div>
//                         </div>
//                     ))}
//                 </div>
//                 <form onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment.mutate(comment.trim()); }} className="mt-4 flex gap-2">
//                     <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment..." className={input} />
//                     <button type="submit" disabled={!comment.trim()} className={btnPrimary}>Send</button>
//                 </form>
//             </div>
//         </div>
//     );
// }