// apps/web/src/pages/Discussions.tsx
//
// A discussion board per team: posts with replies, meant for decisions and
// write-ups ("which design system do we adopt?") rather than live chat. The API
// lets every workspace member read, while posting requires team membership.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, MessageSquare, Plus, Trash2 } from 'lucide-react';
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

interface DiscussionReply {
    id: string;
    body: string;
    createdAt: string;
    author: DiscussionAuthor;
}

interface DiscussionDetail extends Omit<DiscussionSummary, 'replyCount'> {
    body: string;
    team: { id: string; name: string };
    replies: DiscussionReply[];
}

const when = (value: string) =>
    new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

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
                    onCreated={() => {
                        setComposing(false);
                        void qc.invalidateQueries({ queryKey: ['discussions', teamId] });
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
    onCreated: () => void;
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [error, setError] = useState('');

    const create = useMutation({
        mutationFn: () => apiClient.post(`/teams/${teamId}/discussions`, { title: title.trim(), body }),
        onSuccess: onCreated,
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
