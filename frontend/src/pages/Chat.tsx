import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Check, CheckCheck, MessageCircle, Send } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';
import { useAuth } from '../lib/auth';
import { btnPrimary, input } from '../components/QuickCreateTask';

interface TeamMessage {
  id: string;
  body: string;
  createdAt: string;
  mentionUserIds: string[];
  receipts?: { userId: string; deliveredAt: string | null; readAt: string | null; user: { id: string; name: string } }[];
  sender: { id: string; name: string; avatarUrl?: string | null; role?: string; specialties?: string[] };
}

interface Member {
  isActive: boolean;
  role?: string;
  specialty?: string | null;
  specialties?: string[];
  user: { id: string; name: string; avatarUrl?: string | null; lastSeenAt?: string | null; isOnline?: boolean };
}

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const recipientId = searchParams.get('with');
  const [body, setBody] = useState('');
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  const membersQuery = useQuery({
    queryKey: ['members'],
    queryFn: () => apiClient.get<Member[]>('/members'),
    refetchInterval: 15_000,
  });
  const members = useMemo(() => (membersQuery.data ?? [])
    .filter((member) => member.isActive && member.user.id !== user?.id), [membersQuery.data, user?.id]);
  const recipientMember = members.find((member) => member.user.id === recipientId);
  const recipient = recipientMember?.user;
  const chatQuery = useQuery({
    queryKey: ['chat-messages', recipientId ?? 'team'],
    queryFn: () => {
      const params = new URLSearchParams();
      if (recipientId) params.set('with', recipientId);
      params.set('read', String(document.visibilityState === 'visible'));
      return apiClient.get<TeamMessage[]>(`/chat/messages?${params.toString()}`);
    },
    refetchInterval: 3000,
  });
  const messages = Array.isArray(chatQuery.data)
    ? chatQuery.data.filter((message) => message && typeof message.body === 'string' && message.sender)
    : [];
  const error = chatQuery.error ?? membersQuery.error ?? (chatQuery.data !== undefined && !Array.isArray(chatQuery.data)
    ? new Error('The chat API returned an unexpected response.')
    : null);
  const currentMention = body.match(/@([\p{L}\p{N}_-]*)$/u)?.[1];
  const suggestions = currentMention === undefined ? [] : members.filter(({ user: member }) =>
    member.name.toLocaleLowerCase().includes(currentMention.toLocaleLowerCase()),
  ).slice(0, 6);

  const send = useMutation({
    mutationFn: (message: string) => apiClient.post<TeamMessage>('/chat/messages', {
      body: message,
      ...(recipientId ? { recipientId } : {}),
      mentionUserIds: mentionedIds.filter((id) => {
        const name = members.find((member) => member.user.id === id)?.user.name;
        return name && message.includes(`@${name}`);
      }),
    }),
    onSuccess: async () => {
      setBody('');
      setMentionedIds([]);
      await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
    },
  });

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length, recipientId]);

  const selectChat = (id?: string) => setSearchParams(id ? { with: id } : {});
  const presenceLabel = (lastSeenAt?: string | null, isOnline?: boolean) => {
    if (!lastSeenAt) return { online: false, label: t('chat.offline') };
    const seenAt = new Date(lastSeenAt);
    const online = isOnline === true && Date.now() - seenAt.getTime() < 90_000;
    return {
      online,
      label: online ? t('chat.online') : t('chat.lastSeen', { date: seenAt.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) }),
    };
  };
  const chooseMention = (member: Member['user']) => {
    const nextBody = body.replace(/@[\p{L}\p{N}_-]*$/u, `@${member.name} `);
    setBody(nextBody);
    setMentionedIds((current) => current.includes(member.id) ? current : [...current, member.id]);
  };
  return <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-6xl flex-col">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{t('chat.title')}</h1><p className="mt-1 text-sm text-gray-500">{t('chat.subtitle')}</p></div>
    </header>

    <section aria-label={t('chat.title')} className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="max-h-36 overflow-y-auto border-b border-gray-200 p-2 md:max-h-none md:border-b-0 md:border-e">
        <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('chat.conversations')}</p>
        <button type="button" onClick={() => selectChat()} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm ${!recipientId ? 'bg-blue-50 font-semibold text-[#1D4ED8]' : 'text-gray-700 hover:bg-gray-50'}`}>
          <MessageCircle className="size-4 shrink-0" />{t('chat.teamRoom')}
        </button>
        <p className="px-2 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('chat.privateChats')}</p>
        {membersQuery.isLoading && <p className="px-3 py-2 text-xs text-gray-400">{t('common.loading')}</p>}
        {members.map((member) => {
          const presence = presenceLabel(member.user.lastSeenAt, member.user.isOnline);
          return <button key={member.user.id} type="button" onClick={() => selectChat(member.user.id)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm ${recipientId === member.user.id ? 'bg-blue-50 font-semibold text-[#1D4ED8]' : 'text-gray-700 hover:bg-gray-50'}`}>
          <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">{member.user.name.slice(0, 1).toUpperCase()}<span className={`absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-white ${presence.online ? 'bg-emerald-500' : 'bg-gray-300'}`} /></span>
          <span className="min-w-0"><span className="block truncate">{member.user.name}</span><span className="block truncate text-[11px] font-normal text-gray-500">{[presence.label, t(`auth.${member.role?.toLowerCase() ?? 'member'}`), ...(member.specialties?.length ? member.specialties : member.specialty ? [member.specialty] : [])].join(' · ')}</span></span>
        </button>;
        })}
      </aside>

      <div className="flex min-h-[420px] min-w-0 flex-col">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="font-semibold">{recipient ? recipient.name : t('chat.teamRoom')}</h2>
          {recipient && <p className="mt-0.5 text-xs text-gray-500">{[presenceLabel(recipientMember?.user.lastSeenAt, recipientMember?.user.isOnline).label, t(`auth.${recipientMember?.role?.toLowerCase() ?? 'member'}`), ...(recipientMember?.specialties?.length ? recipientMember.specialties : recipientMember?.specialty ? [recipientMember.specialty] : []), t('chat.privateSubtitle')].join(' · ')}</p>}
        </div>
        {error && <div role="alert" className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-white p-3 text-sm text-red-700"><span className="min-w-0 flex-1">{t('common.error')}: {(error as Error).message}</span><button type="button" onClick={() => void chatQuery.refetch()} className="rounded-md border border-red-200 bg-white px-3 py-1.5 hover:bg-red-50">{t('common.retry')}</button></div>}
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {chatQuery.isLoading && <p className="text-center text-sm text-gray-500">{t('common.loading')}</p>}
          {!chatQuery.isLoading && !error && messages.length === 0 && <p className="py-12 text-center text-sm text-gray-500">{t('chat.empty')}</p>}
          {messages.map((message) => {
            const own = message.sender.id === user?.id;
            const senderName = message.sender.name || message.sender.id;
            return <article key={message.id} className={`flex gap-2.5 ${own ? 'flex-row-reverse' : ''}`}>
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-semibold text-[#2563EB]">{senderName.slice(0, 1).toUpperCase()}</div>
              <div className={`max-w-[85%] sm:max-w-[70%] ${own ? 'text-end' : ''}`}>
                <div className={`mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-gray-500 ${own ? 'justify-end' : ''}`}><span className="font-medium text-gray-700">{own ? t('chat.you') : senderName}</span><span>{[t(`auth.${message.sender.role?.toLowerCase() ?? 'member'}`), ...(message.sender.specialties ?? [])].join(' · ')}</span><time>{new Date(message.createdAt).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' })}</time></div>
                <p className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm ${own ? 'rounded-ee-sm bg-[#2563EB] text-white' : 'rounded-es-sm bg-gray-100 text-gray-800'}`}>{message.body}</p>
                {own && message.receipts?.length ? <div className="mt-1 flex flex-wrap items-center justify-end gap-x-2 text-[10px] text-gray-500">
                  {message.receipts.some((receipt) => receipt.readAt) ? <CheckCheck className="size-3.5 text-blue-600" /> : message.receipts.some((receipt) => receipt.deliveredAt) ? <CheckCheck className="size-3.5" /> : <Check className="size-3.5" />}
                  <span>{t('chat.deliveredCount', { count: message.receipts.filter((receipt) => receipt.deliveredAt).length, total: message.receipts.length })}</span>
                  <span>{t('chat.readBy', { names: message.receipts.filter((receipt) => receipt.readAt).map((receipt) => receipt.user.name).join(', ') || t('chat.nobodyYet') })}</span>
                </div> : null}
              </div>
            </article>;
          })}
          <div ref={bottom} />
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (body.trim()) send.mutate(body.trim()); }} className="relative flex gap-2 border-t border-gray-200 p-3 sm:p-4">
          {suggestions.length > 0 && <div className="absolute bottom-full start-4 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {suggestions.map((member) => <button key={member.user.id} type="button" onClick={() => chooseMention(member.user)} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-blue-50"><AtSign className="size-3.5 text-blue-600" />{member.user.name}</button>)}
          </div>}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (body.trim()) send.mutate(body.trim()); } }} maxLength={3000} rows={1} placeholder={t('chat.placeholder')} className={`${input} min-h-10 resize-y`} />
          <button className={btnPrimary} type="submit" disabled={!body.trim() || send.isPending} aria-label={t('chat.send')}><Send className="size-4" /></button>
        </form>
        {send.error && <p role="alert" className="px-4 pb-3 text-sm text-red-600">{(send.error as Error).message}</p>}
      </div>
    </section>
  </div>;
}
