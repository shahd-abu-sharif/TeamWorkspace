import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { btnPrimary, btnSecondary, btnDanger, input } from '../components/QuickCreateTask';
import { ErrorState, PriorityDot, StatusBadge } from './Dashboard';
import { Download, Paperclip, Upload, Play, Pause, Clock, Link as LinkIcon, Plus, AlertTriangle } from 'lucide-react';

export function TaskDetailPage() {
    const { id = '' } = useParams();
    const { role, user } = useAuth();
    const qc = useQueryClient();
    const [comment, setComment] = useState('');
    const [reviewNote, setReviewNote] = useState('');
    const [attachmentError, setAttachmentError] = useState('');
    const [newLink, setNewLink] = useState('');

    // لتخزين الوقت الحي (الوقت الحالي الذي يمر)
    const [liveSeconds, setLiveSeconds] = useState(0);

    const { data: task, isLoading, error } = useQuery({
        queryKey: ['task', id],
        queryFn: () => apiClient.get<any>(`/tasks/${id}`),
        enabled: Boolean(id),
        refetchInterval: 10_000, 
    });

    const invalidate = () => {
        void qc.invalidateQueries({ queryKey: ['task', id] });
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        void qc.invalidateQueries({ queryKey: ['board'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
    };

    const patch = useMutation({
        mutationFn: (body: Record<string, unknown>) => apiClient.patch(`/tasks/${id}`, body),
        onSuccess: invalidate,
    });

    // ================= Timer Logic =================

    const closedSeconds = task?.timeEntries
        ?.filter((e: any) => e.user.id === user?.id && e.endedAt)
        .reduce((sum: number, entry: any) => {
            const start = new Date(entry.startedAt).getTime();
            const end = new Date(entry.endedAt).getTime();
            return sum + Math.max(0, Math.floor((end - start) / 1000));
        }, 0) || 0;

    const openEntry = task?.timeEntries?.find((e: any) => e.user.id === user?.id && !e.endedAt);
    const isTracking = !!openEntry;

    useEffect(() => {
        if (!openEntry) {
            setLiveSeconds(0);
            return;
        }
        const start = new Date(openEntry.startedAt).getTime();
        const update = () => setLiveSeconds(Math.floor((Date.now() - start) / 1000));
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [openEntry]);

    const totalSeconds = closedSeconds + liveSeconds;

    const timerMutation = useMutation({
        mutationFn: (action: 'pause' | 'resume') =>
            action === 'pause'
                ? apiClient.post(`/tasks/${id}/timer/pause`)
                : apiClient.post(`/tasks/${id}/timer/start`), 
        onSuccess: invalidate,
    });

    const formatTime = (totalSecs: number) => {
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const currentLoggedHrs = (task?.actualHrs || 0) + (liveSeconds / 3600);
    const isOverEstimate = task?.estimatedHrs && currentLoggedHrs > task.estimatedHrs;

    // ================= Review Actions =================
    const review = useMutation({
        mutationFn: (decision: 'approve' | 'request_changes') =>
            apiClient.post(`/tasks/${id}/review`, { decision, note: reviewNote || undefined }),
        onSuccess: () => { setReviewNote(''); invalidate(); },
    });

    // ================= Links & Attachments =================
    const addLink = () => {
        if (!newLink.trim()) return;
        patch.mutate({ links: [...(task.links || []), newLink.trim()] });
        setNewLink('');
    };

    const removeLink = (linkToRemove: string) => {
        patch.mutate({ links: (task.links || []).filter((l: string) => l !== linkToRemove) });
    };

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

    const canEditAll = role === 'LEADER';
    const isAssignee = task.assignees.some((a: any) => a.user.id === user?.id);
    const canTrackTime = isAssignee || canEditAll;

    return (
        <div className="mx-auto max-w-4xl space-y-6">
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

                {canEditAll && (
                    <div className="flex gap-2">
                        <button onClick={() => patch.mutate({ isArchived: !task.isArchived })} className={btnSecondary}>
                            {task.isArchived ? 'Restore' : 'Archive'}
                        </button>
                        <button onClick={() => { if (confirm('Delete permanently?')) remove.mutate(); }} className={btnDanger}>
                            Delete
                        </button>
                    </div>
                )}
            </header>

            <div className="grid gap-6 lg:grid-cols-3">
                <section className="space-y-6 lg:col-span-2">
                    {/* Description */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Description</h2>
                        <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">
                            {task.description || 'No description provided.'}
                        </p>
                    </div>

                    {/* Timer & Progress */}
                    {canTrackTime && (
                        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                            <h2 className="mb-4 font-semibold">Progress & Time Tracking</h2>

                            {task.status === 'IN_PROGRESS' && (
                                <div className={`mb-6 flex flex-col gap-3 rounded-lg p-4 ${isOverEstimate ? 'bg-red-50 border border-red-200 dark:bg-red-900/20' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Clock className={`size-5 ${isOverEstimate ? 'text-red-500' : 'text-[#2563EB]'}`} />
                                            <div>
                                                <p className={`text-sm font-medium ${isOverEstimate ? 'text-red-700 dark:text-red-400' : 'text-[#1D4ED8] dark:text-blue-300'}`}>
                                                    {isTracking ? 'Time Tracking Active' : 'Timer Paused'}
                                                </p>
                                                <p className="text-2xl font-bold tabular-nums">
                                                    {formatTime(totalSeconds)}
                                                </p>
                                            </div>
                                        </div>
                                        {isTracking ? (
                                            <button onClick={() => timerMutation.mutate('pause')} disabled={timerMutation.isPending} className="flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-200">
                                                <Pause className="size-4" /> Pause
                                            </button>
                                        ) : (
                                            <button onClick={() => timerMutation.mutate('resume')} disabled={timerMutation.isPending} className="flex items-center gap-2 rounded-lg bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-200">
                                                <Play className="size-4" /> Resume
                                            </button>
                                        )}
                                    </div>

                                    {isOverEstimate && (
                                        <div className="flex items-center gap-2 text-sm text-red-600 font-medium">
                                            <AlertTriangle className="size-4" />
                                            Warning: Logged hours exceeded estimated hours ({task.estimatedHrs}h)!
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="space-y-4">
                                <label className="block">
                                    <span className="mb-2 flex justify-between text-sm font-medium">
                                        <span>Progress</span>
                                        <span>{task.progress}%</span>
                                    </span>
                                    <input
                                        type="range" min={0} max={100} step={5} defaultValue={task.progress}
                                        onMouseUp={(e) => patch.mutate({ progress: Number((e.target as HTMLInputElement).value) })}
                                        onTouchEnd={(e) => patch.mutate({ progress: Number((e.target as HTMLInputElement).value) })}
                                        className="w-full accent-[#2563EB]"
                                    />
                                </label>
                                <div className="flex justify-between text-sm text-slate-500">
                                    <span>Logged: {currentLoggedHrs.toFixed(2)}h</span>
                                    <span>Estimated: {task.estimatedHrs ?? '—'}h</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Review Actions (For Leader) */}
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
                                <button onClick={() => review.mutate('approve')} className={btnPrimary}>
                                    Approve completion
                                </button>
                                <button onClick={() => review.mutate('request_changes')} className={btnSecondary}>
                                    Request changes
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Links Section */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 flex items-center gap-2 font-semibold"><LinkIcon className="size-4" /> Relevant Links</h2>
                        <ul className="space-y-2 mb-4">
                            {(task.links || []).map((link: string, i: number) => (
                                <li key={i} className="flex items-center justify-between gap-2 rounded bg-slate-50 p-2 text-sm dark:bg-slate-800">
                                    <a href={link} target="_blank" rel="noreferrer" className="text-[#2563EB] hover:underline truncate">
                                        {link}
                                    </a>
                                    {canTrackTime && (
                                        <button onClick={() => removeLink(link)} className="text-red-500 hover:text-red-700 text-xs">Remove</button>
                                    )}
                                </li>
                            ))}
                            {(task.links || []).length === 0 && <p className="text-sm text-slate-400">No links added yet.</p>}
                        </ul>

                        {canTrackTime && (
                            <div className="flex gap-2">
                                <input
                                    value={newLink}
                                    onChange={(e) => setNewLink(e.target.value)}
                                    placeholder="https://example.com"
                                    className={input}
                                />
                                <button onClick={addLink} disabled={!newLink.trim()} className={btnSecondary}>
                                    <Plus className="size-4" />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Files & Images */}
                    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <Paperclip className="size-4 text-slate-500" />
                                <h2 className="font-semibold">Files and images ({task.attachments?.length ?? 0})</h2>
                            </div>
                            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 ${uploadAttachment.isPending ? 'pointer-events-none opacity-50' : ''}`}>
                                <Upload className="size-4" /> {uploadAttachment.isPending ? 'Uploading…' : 'Upload file'}
                                <input type="file" className="sr-only" disabled={uploadAttachment.isPending} onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) uploadAttachment.mutate(file);
                                    event.currentTarget.value = '';
                                }} />
                            </label>
                        </div>
                        {attachmentError && <p className="mb-3 text-sm text-red-600">{attachmentError}</p>}
                        {task.attachments?.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                            {task.attachments.map((file: any) => <li key={file.id} className="flex items-center gap-3 py-2.5">
                                {file.mimeType.startsWith('image/') ? <span className="grid size-9 place-items-center rounded bg-blue-50 text-xs text-blue-700">IMG</span> : <Paperclip className="ms-2 size-4 text-slate-400" />}
                                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.fileName}</p></div>
                                <button type="button" onClick={async () => {
                                    try {
                                        const result = await apiClient.get<any>(`/tasks/${id}/attachments/${file.id}/download`);
                                        if (result.url) { window.open(result.url, '_blank', 'noopener,noreferrer'); return; }
                                        const bytes = Uint8Array.from(atob(result.content), (char) => char.charCodeAt(0));
                                        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
                                        const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = file.fileName; anchor.click(); URL.revokeObjectURL(objectUrl);
                                    } catch (err) { setAttachmentError((err as Error).message); }
                                }} className="rounded p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Download className="size-4" /></button>
                            </li>)}
                        </ul> : <p className="text-sm text-slate-500">No files uploaded.</p>}
                    </section>
                </section>

                {/* Sidebar: Details & Activity */}
                <aside className="space-y-6">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Details</h2>
                        <dl className="space-y-3 text-sm">
                            <div>
                                <dt className="text-slate-500">Assignees</dt>
                                <dd className="mt-1">
                                    {task.assignees.length
                                        ? task.assignees.map((a: any) => <span key={a.user.id} className="mr-2 inline-block">{a.user.name}</span>)
                                        : <span className="text-[#b45309]">Unassigned</span>}
                                </dd>
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
                                <dt className="text-slate-500">Logged hours</dt>
                                <dd>{task.actualHrs}</dd>
                            </div>
                        </dl>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Activity</h2>
                        <ul className="space-y-3 text-xs">
                            {task.activities.map((a: any) => (
                                <li key={a.id} className="text-slate-600 dark:text-slate-400">
                                    <span className="font-medium text-slate-900 dark:text-slate-100">{a.actor.name}</span>{' '}
                                    {a.summary}
                                    <span className="ml-1 text-slate-400">{new Date(a.createdAt).toLocaleString()}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </aside>
            </div>

            {/* Comments Section */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-4 font-semibold">Comments ({task.comments.length})</h2>
                <div className="space-y-4">
                    {task.comments.map((c: any) => (
                        <div key={c.id} className="flex gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#2563EB] text-xs font-semibold text-white">
                                {c.author.name.charAt(0).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm">
                                    <span className="font-medium">{c.author.name}</span>
                                    <span className="ml-2 text-xs text-slate-400">{new Date(c.createdAt).toLocaleString()}</span>
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{c.body}</p>
                            </div>
                        </div>
                    ))}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment.mutate(comment.trim()); }} className="mt-4 flex gap-2">
                    <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment..." className={input} />
                    <button type="submit" disabled={!comment.trim()} className={btnPrimary}>Send</button>
                </form>
            </div>
        </div>
    );
}