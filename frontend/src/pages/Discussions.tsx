// apps/web/src/pages/Discussions.tsx
//
// A discussion board per team: posts with replies, meant for decisions and
// write-ups ("which design system do we adopt?") rather than live chat. The API
// lets every workspace member read, while posting requires team membership.
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowLeft,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    FileText,
    Image as ImageIcon,
    MessageSquare,
    Paperclip,
    Plus,
    Trash2,
    Upload,
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { btnPrimary, btnSecondary, Field, input } from '../components/QuickCreateTask';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

interface DiscussionAuthor {
    id: string;
    name: string;
    avatarUrl: string | null;
}

interface DiscussionSummary {
    id: string;
    title: string;
    status: 'OPEN' | 'RESOLVED';
    createdAt: string;
    lastReplyAt: string | null;
    author: DiscussionAuthor;
    replyCount: number;
}

interface DiscussionFile {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
    uploadedById: string;
}

interface DiscussionReply {
    id: string;
    body: string;
    createdAt: string;
    author: DiscussionAuthor;
    attachments: DiscussionFile[];
}

interface DiscussionDetail extends Omit<DiscussionSummary, 'replyCount'> {
    body: string;
    team: { id: string; name: string };
    attachments: DiscussionFile[];
    replies: DiscussionReply[];
}

const when = (value: string) =>
    new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const fileSize = (bytes: number) =>
    bytes >= 1024 * 1024
        ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const isSheet = (mime: string, name: string) =>
    /spreadsheet|ms-excel|csv/.test(mime) || /\.(xlsx?|csv|ods)$/i.test(name);

const FileIcon = ({ mime, name }: { mime: string; name: string }) => {
    if (isSheet(mime, name))
        return (
            <span className="grid size-8 place-items-center rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50">
                <FileSpreadsheet className="size-4" />
            </span>
        );
    if (mime.startsWith('image/'))
        return (
            <span className="grid size-8 place-items-center rounded bg-blue-50 text-blue-700 dark:bg-blue-950/50">
                <ImageIcon className="size-4" />
            </span>
        );
    return (
        <span className="grid size-8 place-items-center rounded bg-slate-100 text-slate-600 dark:bg-slate-800">
            <FileText className="size-4" />
        </span>
    );
};

/** Download through the API (works for both S3 signed URLs and local disk). */
async function saveFile(file: DiscussionFile) {
    const result = await apiClient.get<any>(`/discussions/attachments/${file.id}/download`);
    if (result.url) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
        return;
    }
    const bytes = Uint8Array.from(atob(result.content), (char) => char.charCodeAt(0));
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
}

function AttachmentList({
    files,
    canRemove,
    onError,
    onRemoved,
}: {
    files: DiscussionFile[];
    canRemove: (file: DiscussionFile) => boolean;
    onError: (message: string) => void;
    onRemoved: () => void;
}) {
    const { t } = useTranslation();
    if (files.length === 0) return null;

    return (
        <ul className="mt-3 space-y-1.5">
            {files.map((file) => (
                <li
                    key={file.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/60"
                >
                    <FileIcon mime={file.mimeType} name={file.fileName} />
                    <button
                        type="button"
                        onClick={() => void saveFile(file).catch((err) => onError((err as Error).message))}
                        className="min-w-0 flex-1 text-start hover:underline"
                        title={t('discussions.attachments')}
                    >
                        <span className="block truncate text-sm font-medium">{file.fileName}</span>
                        <span className="text-[11px] text-slate-500">{fileSize(file.sizeBytes)}</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => void saveFile(file).catch((err) => onError((err as Error).message))}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                        aria-label={t('discussions.attachments')}
                    >
                        <Download className="size-4" />
                    </button>
                    {canRemove(file) && (
                        <button
                            type="button"
                            onClick={async () => {
                                try {
                                    await apiClient.delete(`/discussions/attachments/${file.id}`);
                                    onRemoved();
                                } catch (err) {
                                    onError((err as Error).message);
                                }
                            }}
                            className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                            aria-label={t('discussions.removeFile')}
                        >
                            <Trash2 className="size-4" />
                        </button>
                    )}
                </li>
            ))}
        </ul>
    );
}

function AttachmentPicker({
    onPick,
    busy,
    label,
}: {
    onPick: (file: File) => void;
    busy?: boolean;
    label?: string;
}) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
                <Paperclip className="size-3.5" /> {busy ? t('discussions.uploading') : (label ?? t('discussions.addFile'))}
            </button>
            <input
                ref={inputRef}
                type="file"
                className="sr-only"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onPick(file);
                    event.currentTarget.value = '';
                }}
            />
        </>
    );
}

function StatusChip({ status }: { status: 'OPEN' | 'RESOLVED' }) {
    const { t } = useTranslation();
    return status === 'RESOLVED' ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 className="size-3" /> {t('discussions.resolved')}
        </span>
    ) : (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            {t('discussions.open')}
        </span>
    );
}

/** Panel shown on the team page. */
export function TeamDiscussions({ teamId }: { teamId: string }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const navigate = useNavigate();
    const [status, setStatus] = useState<'' | 'OPEN' | 'RESOLVED'>('');
    const [composing, setComposing] = useState(false);

    const { data, isLoading } = useQuery({
        queryKey: ['discussions', teamId, status],
        queryFn: () =>
            apiClient.get<any>(`/teams/${teamId}/discussions${status ? `?status=${status}` : ''}`),
        enabled: Boolean(teamId),
    });

    const items: DiscussionSummary[] = data?.items ?? [];

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-semibold">
                    <MessageSquare className="size-4 text-slate-500" /> {t('discussions.title')} (
                    {data?.open ?? 0} {t('discussions.open')})
                </h2>
                <div className="flex items-center gap-2">
                    <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as '' | 'OPEN' | 'RESOLVED')}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
                        aria-label={t('discussions.filter')}
                    >
                        <option value="">{t('discussions.all')}</option>
                        <option value="OPEN">{t('discussions.open')}</option>
                        <option value="RESOLVED">{t('discussions.resolved')}</option>
                    </select>
                    <button type="button" onClick={() => setComposing(true)} className={btnPrimary}>
                        <Plus className="me-1 inline size-4" /> {t('discussions.new')}
                    </button>
                </div>
            </div>

            {isLoading ? (
                <p className="py-4 text-sm text-slate-500">{t('common.loading')}</p>
            ) : items.length === 0 ? (
                <p className="py-4 text-sm text-slate-400">{t('discussions.empty')}</p>
            ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((post) => (
                        <li key={post.id} className="py-3">
                            <Link
                                to={`/teams/${teamId}/discussions/${post.id}`}
                                className="block min-w-0 hover:underline"
                            >
                                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                    {post.title} <StatusChip status={post.status} />
                                </p>
                                <p className="mt-0.5 text-xs text-slate-500">
                                    {post.author.name} · {when(post.lastReplyAt ?? post.createdAt)} ·{' '}
                                    {t('discussions.replies', { count: post.replyCount })}
                                </p>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}

            {composing && (
                <NewDiscussionModal
                    teamId={teamId}
                    onClose={() => setComposing(false)}
                    onCreated={(discussionId) => {
                        setComposing(false);
                        void qc.invalidateQueries({ queryKey: ['discussions', teamId] });
                        navigate(`/teams/${teamId}/discussions/${discussionId}`);
                    }}
                />
            )}
        </section>
    );
}

function NewDiscussionModal({
    teamId,
    onClose,
    onCreated,
}: {
    teamId: string;
    onClose: () => void;
    onCreated: (discussionId: string) => void;
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [error, setError] = useState('');

    const create = useMutation({
        mutationFn: async () => {
            const discussion = await apiClient.post<{ id: string }>(`/teams/${teamId}/discussions`, {
                title: title.trim(),
                body,
            });
            // Attach after the post exists; a failed upload must not lose the post.
            const failed: string[] = [];
            for (const file of files) {
                try {
                    await apiClient.upload(`/discussions/${discussion.id}/attachments`, file);
                } catch {
                    failed.push(file.name);
                }
            }
            return { discussion, failed };
        },
        onSuccess: ({ discussion, failed }) => {
            if (failed.length > 0) {
                setError(t('discussions.uploadFailed', { files: failed.join(', ') }));
            }
            onCreated(discussion.id);
        },
        onError: (mutationError) => setError((mutationError as Error).message),
    });

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    setError('');
                    create.mutate();
                }}
                className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{t('discussions.new')}</h2>
                    <button type="button" onClick={onClose} aria-label={t('common.close')}>
                        ✕
                    </button>
                </div>

                {error && (
                    <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}
                    </p>
                )}

                <div className="space-y-4">
                    <Field label={t('discussions.postTitle')}>
                        <input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className={input}
                            placeholder={t('discussions.postTitlePlaceholder')}
                            required
                            minLength={3}
                            maxLength={140}
                            autoFocus
                        />
                    </Field>
                    <Field label={t('discussions.postBody')} hint={t('discussions.markdownHint')}>
                        <MarkdownEditor value={body} onChange={setBody} />
                    </Field>

                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <AttachmentPicker
                                onPick={(file) => {
                                    if (file.size > MAX_FILE_BYTES) {
                                        setError(t('discussions.fileTooBig'));
                                        return;
                                    }
                                    setFiles((current) => [...current, file]);
                                }}
                            />
                            <span className="text-xs text-slate-500">{t('discussions.pendingFiles')}</span>
                        </div>
                        {files.length > 0 && (
                            <ul className="mt-2 space-y-1">
                                {files.map((file, index) => (
                                    <li
                                        key={`${file.name}-${index}`}
                                        className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700"
                                    >
                                        <FileIcon mime={file.type} name={file.name} />
                                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                                        <span className="text-xs text-slate-500">{fileSize(file.size)}</span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setFiles((current) => current.filter((_, i) => i !== index))
                                            }
                                            className="rounded p-1 text-red-600 hover:bg-red-50"
                                            aria-label={t('discussions.removeFile')}
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className={btnSecondary}>
                        {t('common.cancel')}
                    </button>
                    <button type="submit" disabled={create.isPending || !title.trim() || !body.trim()} className={btnPrimary}>
                        {create.isPending ? t('common.saving') : t('discussions.publish')}
                    </button>
                </div>
            </form>
        </div>
    );
}

export function DiscussionDetailPage() {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const { teamId, discussionId } = useParams();
    const { user, role } = useAuth();
    const [reply, setReply] = useState('');
    const [fileError, setFileError] = useState('');

    const { data: post, isLoading, error } = useQuery({
        queryKey: ['discussion', discussionId],
        queryFn: () => apiClient.get<DiscussionDetail>(`/discussions/${discussionId}`),
        enabled: Boolean(discussionId),
    });

    const refresh = () => {
        void qc.invalidateQueries({ queryKey: ['discussion', discussionId] });
        void qc.invalidateQueries({ queryKey: ['discussions', teamId] });
    };

    const send = useMutation({
        mutationFn: () => apiClient.post(`/discussions/${discussionId}/replies`, { body: reply.trim() }),
        onSuccess: () => {
            setReply('');
            refresh();
        },
    });

    const setStatus = useMutation({
        mutationFn: (status: 'OPEN' | 'RESOLVED') =>
            apiClient.patch(`/discussions/${discussionId}`, { status }),
        onSuccess: refresh,
    });

    const upload = useMutation({
        mutationFn: ({ file, replyId }: { file: File; replyId?: string }) =>
            replyId
                ? apiClient.upload(`/discussions/replies/${replyId}/attachments`, file)
                : apiClient.upload(`/discussions/${discussionId}/attachments`, file),
        onSuccess: () => {
            setFileError('');
            refresh();
        },
        onError: (uploadError) => setFileError((uploadError as Error).message),
    });

    const pickFile = (file: File, replyId?: string) => {
        if (file.size > MAX_FILE_BYTES) {
            setFileError(t('discussions.fileTooBig'));
            return;
        }
        upload.mutate({ file, replyId });
    };

    const remove = useMutation({
        mutationFn: () => apiClient.delete(`/discussions/${discussionId}`),
        onSuccess: () => {
            window.location.href = `/teams/${teamId}`;
        },
    });

    if (isLoading) return <p className="py-8 text-sm text-slate-500">{t('common.loading')}</p>;
    if (error || !post) {
        return <p role="alert" className="text-sm text-red-600">{(error as Error)?.message ?? t('discussions.notFound')}</p>;
    }

    const canModerate = role === 'LEADER' || post.author.id === user?.id;

    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <Link
                to={`/teams/${teamId}`}
                className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
            >
                <ArrowLeft className="size-4" /> {post.team.name}
            </Link>

            {fileError && (
                <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {fileError}
                </p>
            )}

            <article className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-xl font-semibold">{post.title}</h1>
                        <p className="mt-1 text-xs text-slate-500">
                            {post.author.name} · {when(post.createdAt)}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <StatusChip status={post.status} />
                        {canModerate && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setStatus.mutate(post.status === 'OPEN' ? 'RESOLVED' : 'OPEN')}
                                    disabled={setStatus.isPending}
                                    className={btnSecondary}
                                >
                                    {post.status === 'OPEN' ? t('discussions.markResolved') : t('discussions.reopen')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (confirm(t('discussions.deleteConfirm'))) remove.mutate();
                                    }}
                                    className="rounded-md p-2 text-red-600 hover:bg-red-50"
                                    aria-label={t('common.delete')}
                                >
                                    <Trash2 className="size-4" />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                    <MarkdownRenderer content={post.body} />
                </div>

                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                            <Paperclip className="size-3.5" /> {t('discussions.attachments')} ({post.attachments.length})
                        </p>
                        <AttachmentPicker
                            onPick={(file) => pickFile(file)}
                            busy={upload.isPending}
                            label={t('discussions.addFile')}
                        />
                    </div>
                    <AttachmentList
                        files={post.attachments}
                        canRemove={(file) => canModerate || file.uploadedById === user?.id}
                        onError={setFileError}
                        onRemoved={refresh}
                    />
                </div>
            </article>

            <section className="space-y-3">
                <h2 className="font-semibold">
                    {t('discussions.replies', { count: post.replies.length })}
                </h2>

                {post.replies.length === 0 && (
                    <p className="text-sm text-slate-400">{t('discussions.noReplies')}</p>
                )}

                <ul className="space-y-3">
                    {post.replies.map((item) => (
                        <li
                            key={item.id}
                            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                        >
                            <p className="text-xs text-slate-500">
                                <span className="font-medium text-slate-700 dark:text-slate-200">{item.author.name}</span> ·{' '}
                                {when(item.createdAt)}
                            </p>
                            <div className="mt-2">
                                <MarkdownRenderer content={item.body} />
                            </div>
                            <AttachmentList
                                files={item.attachments}
                                canRemove={(file) => canModerate || file.uploadedById === user?.id}
                                onError={setFileError}
                                onRemoved={refresh}
                            />
                            <div className="mt-2">
                                <AttachmentPicker
                                    onPick={(file) => pickFile(file, item.id)}
                                    busy={upload.isPending}
                                    label={t('discussions.addFile')}
                                />
                            </div>
                        </li>
                    ))}
                </ul>

                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!reply.trim()) return;
                        send.mutate();
                    }}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                    <Field label={t('discussions.yourReply')} hint={t('discussions.markdownHint')}>
                        <MarkdownEditor value={reply} onChange={setReply} />
                    </Field>
                    {send.error && (
                        <p role="alert" className="mt-2 text-sm text-red-600">
                            {(send.error as Error).message}
                        </p>
                    )}
                    <div className="mt-3 flex justify-end">
                        <button type="submit" disabled={send.isPending || !reply.trim()} className={btnPrimary}>
                            {send.isPending ? t('common.saving') : t('discussions.reply')}
                        </button>
                    </div>
                </form>
            </section>
        </div>
    );
}
