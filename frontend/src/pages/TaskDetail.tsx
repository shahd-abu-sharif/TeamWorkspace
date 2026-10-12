// apps/web/src/pages/TaskDetail.tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { btnPrimary, btnSecondary, btnDanger, input } from '../components/QuickCreateTask';
import { ErrorState, PriorityDot, StatusBadge } from './Dashboard';
import { Download, Paperclip, Upload } from 'lucide-react';

export function TaskDetailPage() {
    const { id = '' } = useParams();
    const { role } = useAuth();
    const qc = useQueryClient();
    const [comment, setComment] = useState('');
    const [reviewNote, setReviewNote] = useState('');
    const [attachmentError, setAttachmentError] = useState('');

    const { data: task, isLoading, error } = useQuery({
        queryKey: ['task', id],
        queryFn: () => apiClient.get<any>(`/tasks/${id}`),
        enabled: Boolean(id),
        refetchInterval: 30_000,
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

    const addComment = useMutation({
        mutationFn: (body: string) => apiClient.post(`/tasks/${id}/comments`, { body }),
        onSuccess: () => {
            setComment('');
            invalidate();
        },
    });

    const review = useMutation({
        mutationFn: (decision: 'approve' | 'request_changes') =>
            apiClient.post(`/tasks/${id}/review`, { decision, note: reviewNote || undefined }),
        onSuccess: () => {
            setReviewNote('');
            invalidate();
        },
    });

    const uploadAttachment = useMutation({
        mutationFn: (file: File) => apiClient.upload(`/tasks/${id}/attachments`, file),
        onSuccess: () => { setAttachmentError(''); invalidate(); },
        onError: (err) => setAttachmentError((err as Error).message),
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
                        {task.workstream && <span className="text-sm text-slate-500">{task.workstream.name}</span>}
                        {task.isArchived && (
                            <span className="rounded bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-800">Archived</span>
                        )}
                    </div>
                </div>

                {canEditAll && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => apiClient.patch(`/tasks/${id}/archive`, { isArchived: !task.isArchived }).then(invalidate)}
                            className={btnSecondary}
                        >
                            {task.isArchived ? 'Restore' : 'Archive'}
                        </button>
                        <button
                            onClick={() => {
                                if (confirm('Delete this task permanently? This cannot be undone.')) remove.mutate();
                            }}
                            className={btnDanger}
                        >
                            Delete
                        </button>
                    </div>
                )}
            </header>

            <div className="grid gap-6 lg:grid-cols-3">
                <section className="space-y-6 lg:col-span-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Description</h2>
                        {task.description ? (
                            <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{task.description}</p>
                        ) : (
                            <p className="text-sm text-slate-400">No description provided.</p>
                        )}
                    </div>

                    <section className="rounded-xl border border-slate-200 bg-white p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2"><Paperclip className="size-4 text-slate-500" /><h2 className="font-semibold">Files and images ({task.attachments?.length ?? 0})</h2></div>
                            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 ${uploadAttachment.isPending ? 'pointer-events-none opacity-50' : ''}`}>
                                <Upload className="size-4" /> {uploadAttachment.isPending ? 'Uploading…' : 'Upload file'}
                                <input type="file" className="sr-only" disabled={uploadAttachment.isPending} onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) uploadAttachment.mutate(file);
                                    event.currentTarget.value = '';
                                }} />
                            </label>
                        </div>
                        {attachmentError && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{attachmentError}</p>}
                        {task.attachments?.length ? <ul className="divide-y divide-slate-100">
                            {task.attachments.map((file: any) => <li key={file.id} className="flex items-center gap-3 py-2.5">
                                {file.mimeType.startsWith('image/') ? <span className="grid size-9 place-items-center rounded bg-blue-50 text-blue-700">IMG</span> : <Paperclip className="ms-2 size-4 shrink-0 text-slate-400" />}
                                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.fileName}</p><p className="text-xs text-slate-500">{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB · {new Date(file.createdAt).toLocaleString()}</p></div>
                                <button type="button" onClick={async () => {
                                    try {
                                        const result = await apiClient.get<any>(`/tasks/${id}/attachments/${file.id}/download`);
                                        if (result.url) { window.open(result.url, '_blank', 'noopener,noreferrer'); return; }
                                        const bytes = Uint8Array.from(atob(result.content), (char) => char.charCodeAt(0));
                                        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
                                        const anchor = document.createElement('a'); anchor.href = objectUrl; anchor.download = file.fileName; anchor.click(); URL.revokeObjectURL(objectUrl);
                                    } catch (err) { setAttachmentError((err as Error).message); }
                                }} className="rounded p-2 text-slate-500 hover:bg-slate-100" aria-label={`Download ${file.fileName}`}><Download className="size-4" /></button>
                            </li>)}
                        </ul> : <p className="text-sm text-slate-500">Upload an image or file to share it with the task team.</p>}
                    </section>

                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Progress</h2>
                        {canEditAll ? <>
                            <div className="flex flex-wrap gap-2">
                                {['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => patch.mutate({ status: s })}
                                        disabled={Boolean(task.startedAt && (s === 'BACKLOG' || s === 'TODO'))}
                                        title={task.startedAt && (s === 'BACKLOG' || s === 'TODO') ? 'A started task cannot return to Not started' : undefined}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${task.status === s
                                                ? 'bg-[#2563EB] text-white'
                                                : 'border border-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
                                            }`}
                                    >
                                        {s.replace('_', ' ')}
                                    </button>
                                ))}
                            </div>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">Progress: {task.progress}%</span>
                                    <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        step={5}
                                        defaultValue={task.progress}
                                        onMouseUp={(e) => patch.mutate({ progress: Number((e.target as HTMLInputElement).value) })}
                                        onTouchEnd={(e) => patch.mutate({ progress: Number((e.target as HTMLInputElement).value) })}
                                        className="w-full accent-[#2563EB]"
                                    />
                                </label>
                                <label className="block">
                                    <span className="mb-1 block text-sm font-medium">Log hours worked</span>
                                    <input
                                        type="number"
                                        step="0.5"
                                        min="0"
                                        defaultValue={task.actualHrs}
                                        onBlur={(e) => patch.mutate({ actualHrs: Number(e.target.value) })}
                                        className={input}
                                    />
                                </label>
                            </div>
                        </> : <p className="text-sm text-slate-600 dark:text-slate-400">{task.status.replaceAll('_', ' ')} · {task.progress}%</p>}
                    </div>

                    {/* Review actions */}
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

                    {/* Comments */}
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
                            {task.comments.length === 0 && (
                                <p className="text-sm text-slate-400">No comments yet. Use @name to mention a teammate.</p>
                            )}
                        </div>

                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (comment.trim()) addComment.mutate(comment.trim());
                            }}
                            className="mt-4 flex gap-2"
                        >
                            <input
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                placeholder="Write a comment… use @name to mention someone"
                                className={input}
                            />
                            <button type="submit" disabled={!comment.trim() || addComment.isPending} className={btnPrimary}>
                                Send
                            </button>
                        </form>
                    </div>
                </section>

                {/* Sidebar: metadata + activity */}
                <aside className="space-y-6">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                        <h2 className="mb-3 font-semibold">Details</h2>
                        <dl className="space-y-3 text-sm">
                            <div>
                                <dt className="text-slate-500">Assignees</dt>
                                <dd className="mt-1">
                                    {task.assignees.length
                                        ? task.assignees.map((a: any) => (
                                            <span key={a.user.id} className="mr-2 inline-block">
                                                {a.user.name}
                                            </span>
                                        ))
                                        : <span className="text-[#b45309]">Unassigned</span>}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-slate-500">Start date</dt>
                                <dd>{task.startDate ? new Date(task.startDate).toLocaleDateString() : '—'}</dd>
                            </div>
                            {task.startedAt && <div>
                                <dt className="text-slate-500">Task started</dt>
                                <dd>{new Date(task.startedAt).toLocaleString()}</dd>
                            </div>}
                            <div>
                                <dt className="text-slate-500">Tracked team hours</dt>
                                <dd>{((task.trackedSeconds ?? 0) / 3600).toFixed(2)}h</dd>
                                {task.timeEntries?.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                                    {[...new Set(task.timeEntries.map((entry: any) => entry.user.id))].map((userId: any) => {
                                        const entries = task.timeEntries.filter((entry: any) => entry.user.id === userId);
                                        const seconds = entries.reduce((total: number, entry: any) => total + Math.max(0, ((entry.endedAt ? new Date(entry.endedAt).getTime() : Date.now()) - new Date(entry.startedAt).getTime()) / 1000), 0);
                                        return <li key={userId}>{entries[0].user.name}: {(seconds / 3600).toFixed(2)}h</li>;
                                    })}
                                </ul>}
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
                            <div>
                                <dt className="text-slate-500">Dependencies</dt>
                                <dd>
                                    {task.dependencies.length
                                        ? task.dependencies.map((d: any) => (
                                            <div key={d.dependsOn.id} className="text-xs">
                                                #{d.dependsOn.reference} {d.dependsOn.title} — {d.dependsOn.status}
                                            </div>
                                        ))
                                        : 'None'}
                                </dd>
                            </div>
                            {task.tags.length > 0 && (
                                <div>
                                    <dt className="text-slate-500">Tags</dt>
                                    <dd className="mt-1 flex flex-wrap gap-1">
                                        {task.tags.map((t: any) => (
                                            <span key={t.tag.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                                                {t.tag.name}
                                            </span>
                                        ))}
                                    </dd>
                                </div>
                            )}
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
                            {task.activities.length === 0 && <li className="text-slate-400">No activity recorded.</li>}
                        </ul>
                    </div>
                </aside>
            </div>
        </div>
    );
}
