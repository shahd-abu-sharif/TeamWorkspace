import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Check, CheckCheck, Hash, MessageCircle, Reply, Send, UserRoundPlus, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';
import { useSocket } from '../lib/socket';
import { useAuth } from '../lib/auth';
import { btnPrimary, input } from '../components/QuickCreateTask';

interface ReplyPreview {
  id: string;
  body: string;
  sender: { id: string; name: string };
}

interface TeamMessage {
  id: string;
  body: string;
  createdAt: string;
  mentionUserIds: string[];
  taskMentionIds?: string[];
  replyToId?: string | null;
  replyTo?: ReplyPreview | null;
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

interface Conversation {
  userId: string;
  name: string;
  avatarUrl: string | null;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
  lastSeenAt: string | null;
  isOnline: boolean;
}

interface TaskOption {
  id: string;
  reference: number;
  title: string;
  status: string;
  priority: string;
}

export function ChatPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const recipientId = searchParams.get('with');

  const [body, setBody] = useState('');
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const [mentionedTasks, setMentionedTasks] = useState<TaskOption[]>([]);
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');

  const bottom = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { socket, connected } = useSocket();

  // ============================================================
  // QUERIES
  // ============================================================

  // 1. كل الأعضاء (يُستخدم في modal "بدء محادثة جديدة" + mentions)
  const membersQuery = useQuery({
    queryKey: ['members'],
    queryFn: () => apiClient.get<Member[]>('/members'),
    refetchInterval: 30_000,
  });

  // 2. المحادثات النشطة (اللي يظهر بالـ Sidebar)
  const conversationsQuery = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: () => apiClient.get<Conversation[]>('/chat/conversations'),
    refetchInterval: 10_000,
  });

  // كل الأعضاء
  const allMembers = useMemo(
    () => (membersQuery.data ?? []).filter((m) => m.isActive && m.user.id !== user?.id),
    [membersQuery.data, user?.id],
  );

  // alias للاستخدام السهل
  const members = allMembers;

  // المحادثات النشطة
  const conversations = conversationsQuery.data ?? [];

  // الطرف الآخر في الدردشة الحالية
  const recipientMember = allMembers.find((m) => m.user.id === recipientId);
  const recipient = recipientMember?.user;

  // رسائل الدردشة الحالية
  const chatQuery = useQuery({
    queryKey: ['chat-messages', recipientId ?? 'team'],
    queryFn: () => {
      const params = new URLSearchParams();
      if (recipientId) params.set('with', recipientId);
      params.set('read', String(document.visibilityState === 'visible'));
      return apiClient.get<TeamMessage[]>(`/chat/messages?${params.toString()}`);
    },
    refetchInterval: 30000,
  });

  const messages = Array.isArray(chatQuery.data)
    ? chatQuery.data.filter((m) => m && typeof m.body === 'string' && m.sender)
    : [];

  const error =
    chatQuery.error ??
    membersQuery.error ??
    conversationsQuery.error ??
    (chatQuery.data !== undefined && !Array.isArray(chatQuery.data)
      ? new Error('The chat API returned an unexpected response.')
      : null);

  // // ============================================================
  // // QUERIES
  // // ============================================================

  // const membersQuery = useQuery({
  //   queryKey: ['members'],
  //   queryFn: () => apiClient.get<Member[]>('/members'),
  //   refetchInterval: 15_000,
  // });

  // const members = useMemo(
  //   () => (membersQuery.data ?? []).filter((m) => m.isActive && m.user.id !== user?.id),
  //   [membersQuery.data, user?.id],
  // );

  // const recipientMember = members.find((m) => m.user.id === recipientId);
  // const recipient = recipientMember?.user;

  // const chatQuery = useQuery({
  //   queryKey: ['chat-messages', recipientId ?? 'team'],
  //   queryFn: () => {
  //     const params = new URLSearchParams();
  //     if (recipientId) params.set('with', recipientId);
  //     params.set('read', String(document.visibilityState === 'visible'));
  //     return apiClient.get<TeamMessage[]>(`/chat/messages?${params.toString()}`);
  //   },
  //   refetchInterval: 30000, 
  // });

  // const messages = Array.isArray(chatQuery.data)
  //   ? chatQuery.data.filter((m) => m && typeof m.body === 'string' && m.sender)
  //   : [];

  // const error =
  //   chatQuery.error ??
  //   membersQuery.error ??
  //   (chatQuery.data !== undefined && !Array.isArray(chatQuery.data)
  //     ? new Error('The chat API returned an unexpected response.')
  //     : null);

  // ============================================================
  // SOCKET LISTENERS
  // ============================================================

  // useEffect(() => {
  //   if (!socket) return;

  //   const onNewMessage = () => {
  //     void queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
  //     void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
  //   };

  //   const onTyping = ({ userId, recipientId: rId }: { userId: string; recipientId: string | null }) => {
  //     if (userId === user?.id) return;
  //     // في غرفة الفريق: فقط إذا الرسالة عامة
  //     if (!recipientId && rId) return;
  //     // في دردشة خاصة: فقط إذا الرسالة موجّهة لي
  //     if (recipientId && rId !== user?.id) return;
  //     setTypingUsers((prev) => new Set(prev).add(userId));
  //   };

  //   const onStopTyping = ({ userId }: { userId: string }) => {
  //     setTypingUsers((prev) => {
  //       const next = new Set(prev);
  //       next.delete(userId);
  //       return next;
  //     });
  //   };

  //   socket.on('message:new', onNewMessage);
  //   socket.on('user:typing', onTyping);
  //   socket.on('user:stopTyping', onStopTyping);

  //   return () => {
  //     socket.off('message:new', onNewMessage);
  //     socket.off('user:typing', onTyping);
  //     socket.off('user:stopTyping', onStopTyping);
  //   };
  // }, [socket, user?.id, recipientId, queryClient]);

  // // انضمام لغرفة الفريق
  // useEffect(() => {
  //   if (!socket) return;
  //   if (!recipientId) {
  //     socket.emit('room:join', { room: 'team-room' });
  //     return () => {
  //       socket.emit('room:leave', { room: 'team-room' });
  //     };
  //   }
  // }, [socket, recipientId]);


  useEffect(() => {
    if (!socket) return;

    const onNewMessage = () => {
      void queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    };

    const onTyping = ({ userId, recipientId: rId }: { userId: string; recipientId: string | null }) => {
      if (userId === user?.id) return;
      if (!recipientId && rId) return;
      if (recipientId && rId !== user?.id) return;
      setTypingUsers((prev) => new Set(prev).add(userId));
    };

    const onStopTyping = ({ userId }: { userId: string }) => {
      setTypingUsers((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    };

    const onPresenceOnline = ({ userId }: { userId: string }) => {
      const now = new Date().toISOString();

      queryClient.setQueryData<Conversation[]>(['chat-conversations'], (old) => {
        if (!old) return old;
        return old.map((c) =>
          c.userId === userId ? { ...c, isOnline: true, lastSeenAt: now } : c,
        );
      });

      queryClient.setQueryData<Member[]>(['members'], (old) => {
        if (!old) return old;
        return old.map((m) =>
          m.user.id === userId
            ? { ...m, user: { ...m.user, isOnline: true, lastSeenAt: now } }
            : m,
        );
      });
    };

    const onPresenceOffline = ({
      userId,
      lastSeenAt,
    }: {
      userId: string;
      lastSeenAt: string;
    }) => {
      queryClient.setQueryData<Conversation[]>(['chat-conversations'], (old) => {
        if (!old) return old;
        return old.map((c) =>
          c.userId === userId ? { ...c, isOnline: false, lastSeenAt } : c,
        );
      });

      queryClient.setQueryData<Member[]>(['members'], (old) => {
        if (!old) return old;
        return old.map((m) =>
          m.user.id === userId
            ? { ...m, user: { ...m.user, isOnline: false, lastSeenAt } }
            : m,
        );
      });
    };

    socket.on('message:new', onNewMessage);
    socket.on('user:typing', onTyping);
    socket.on('user:stopTyping', onStopTyping);
    socket.on('presence:online', onPresenceOnline);
    socket.on('presence:offline', onPresenceOffline);

    return () => {
      socket.off('message:new', onNewMessage);
      socket.off('user:typing', onTyping);
      socket.off('user:stopTyping', onStopTyping);
      socket.off('presence:online', onPresenceOnline);
      socket.off('presence:offline', onPresenceOffline);
    };
  }, [socket, user?.id, recipientId, queryClient]);
  // ============================================================
  // TYPING NOTIFICATION
  // ============================================================

  const notifyTyping = () => {
    if (!socket) return;
    socket.emit('typing:start', { recipientId: recipientId ?? undefined });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      socket.emit('typing:stop', { recipientId: recipientId ?? undefined });
    }, 2000);
  };

  const stopTyping = () => {
    if (!socket) return;
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    socket.emit('typing:stop', { recipientId: recipientId ?? undefined });
  };

  // ============================================================
  // SEND MESSAGE
  // ============================================================

  const send = useMutation({
    mutationFn: (message: string) =>
      apiClient.post<TeamMessage>('/chat/messages', {
        body: message,
        ...(recipientId ? { recipientId } : {}),
        mentionUserIds: mentionedIds.filter((id) => {
          const name = members.find((m) => m.user.id === id)?.user.name;
          return name && message.includes(`@${name}`);
        }),
        taskMentionIds: mentionedTasks.map((tk) => tk.id),
        replyToId: replyTo?.id,
      }),
    onSuccess: async () => {
      setBody('');
      setMentionedIds([]);
      setMentionedTasks([]);
      setReplyTo(null);
      stopTyping();
      await queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
      await queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      textareaRef.current?.focus();
    },
  });

  // ============================================================
  // MENTIONS
  // ============================================================

  const currentMention = body.match(/@([\p{L}\p{N}_-]*)$/u)?.[1];
  const suggestions =
    currentMention === undefined
      ? []
      : members
        .filter(({ user: m }) => m.name.toLocaleLowerCase().includes(currentMention.toLocaleLowerCase()))
        .slice(0, 6);

  const chooseMention = (m: Member['user']) => {
    setBody((prev) => prev.replace(/@[\p{L}\p{N}_-]*$/u, `@${m.name} `));
    setMentionedIds((prev) => (prev.includes(m.id) ? prev : [...prev, m.id]));
    textareaRef.current?.focus();
  };

  const insertTask = (task: TaskOption) => {
    setBody((prev) => prev.replace(/#[\w\d-]*$/, '') + `#${task.reference} `);
    setMentionedTasks((prev) => (prev.find((tk) => tk.id === task.id) ? prev : [...prev, task]));
    setTaskPickerOpen(false);
    setTaskSearch('');
    textareaRef.current?.focus();
  };

  // ============================================================
  // SCROLL + PRESENCE
  // ============================================================

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
      label: online
        ? t('chat.online')
        : t('chat.lastSeen', {
          date: seenAt.toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
        }),
    };
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="mx-auto flex h-[calc(100dvh-3rem)] max-w-6xl flex-col overflow-hidden p-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('chat.title')}</h1>

        </div>
        {/* <button
          type="button"
          onClick={() => setNewChatOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <UserRoundPlus className="size-4" />
          {t('chat.startPrivateChat')}
        </button> */}
        <p className="mt-1 text-sm text-gray-500">
          {connected ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-600">
              <span className="size-2 rounded-full bg-emerald-500" />
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-amber-600">
              <span className="size-2 animate-pulse rounded-full bg-amber-500" />
              Reconnecting…
            </span>
          )}
        </p>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:grid-cols-[220px_minmax(0,1fr)]">

        {/* ---------- SIDEBAR ---------- */}
        <aside className="max-h-36 overflow-y-auto border-b border-gray-200 p-2 md:max-h-none md:border-b-0 md:border-e">

          <button
            type="button"
            onClick={() => setNewChatOpen(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-start text-sm font-medium text-gray-600 transition hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#2563EB]"
          >
            <UserRoundPlus className="size-4 shrink-0" />
            Start new chat
          </button>

          <button
            type="button"
            onClick={() => selectChat()}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm ${!recipientId ? 'bg-blue-50 font-semibold text-[#1D4ED8]' : 'text-gray-700 hover:bg-gray-50'
              }`}
          >
            <MessageCircle className="size-4 shrink-0" />
            {t('chat.teamRoom')}
          </button>


          <p className="px-2 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t('chat.privateChats')}
          </p>

          {conversationsQuery.isLoading && (
            <p className="px-3 py-2 text-xs text-gray-400">{t('common.loading')}</p>
          )}

          {!conversationsQuery.isLoading && conversations.length === 0 && (
            <p className="px-3 py-3 text-center text-xs text-gray-400">
              No conversations yet.
              <br />
              Click <strong>Start new chat</strong> to begin.
            </p>
          )}

          {conversations.map((conv) => {
            const presence = presenceLabel(conv.lastSeenAt, conv.isOnline);
            return (
              <button
                key={conv.userId}
                type="button"
                onClick={() => selectChat(conv.userId)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm ${recipientId === conv.userId
                  ? 'bg-blue-50 font-semibold text-[#1D4ED8]'
                  : 'text-gray-700 hover:bg-gray-50'
                  }`}
              >
                {/* Avatar + dot (أخضر/رمادي) */}
                <span className="relative grid size-7 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                  {conv.name.slice(0, 1).toUpperCase()}
                  <span
                    className={`absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-white ${presence.online ? 'bg-emerald-500' : 'bg-gray-300'
                      }`}
                  />
                </span>

                {/* Name + last message */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{conv.name}</span>
                  <span className="block truncate text-[11px] font-normal text-gray-500">
                    {conv.lastMessage.slice(0, 40)}
                  </span>
                </span>

                {/* Unread badge */}
                {conv.unread > 0 && (
                  <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-[#2563EB] px-1.5 text-[10px] font-bold text-white">
                    {conv.unread > 9 ? '9+' : conv.unread}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        {/* ---------- MAIN ---------- */}
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="font-semibold">{recipient ? recipient.name : t('chat.teamRoom')}</h2>

            {/* فقط للدردشة الخاصة — أظهر حالة المستخدم */}
            {recipient && recipientMember && (
              <p className="mt-0.5 text-xs">
                {presenceLabel(recipientMember.user.lastSeenAt, recipientMember.user.isOnline).online ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    {t('chat.online')}
                  </span>
                ) : (
                  <span className="text-gray-500">
                    {presenceLabel(recipientMember.user.lastSeenAt, recipientMember.user.isOnline).label}
                  </span>
                )}
              </p>
            )}

            {/* في غرفة الفريق — عدد الأعضاء */}
            {!recipient && (
              <p className="mt-0.5 text-xs text-gray-500">
                {allMembers.length + 1} members
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-white p-3 text-sm text-red-700"
            >
              <span className="min-w-0 flex-1">
                {t('common.error')}: {(error as Error).message}
              </span>
              <button
                type="button"
                onClick={() => void chatQuery.refetch()}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 hover:bg-red-50"
              >
                {t('common.retry')}
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            {chatQuery.isLoading && (
              <p className="text-center text-sm text-gray-500">{t('common.loading')}</p>
            )}
            {!chatQuery.isLoading && !error && messages.length === 0 && (
              <p className="py-12 text-center text-sm text-gray-500">{t('chat.empty')}</p>
            )}

            {messages.map((message) => {
              const own = message.sender.id === user?.id;
              const senderName = message.sender.name || message.sender.id;
              return (
                <article
                  key={message.id}
                  className={`flex gap-2.5 ${own ? 'flex-row-reverse' : ''}`}
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-blue-100 text-xs font-semibold text-[#2563EB]">
                    {senderName.slice(0, 1).toUpperCase()}
                  </div>

                  <div className={`max-w-[85%] sm:max-w-[70%] ${own ? 'text-end' : ''}`}>
                    <div
                      className={`mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-gray-500 ${own ? 'justify-end' : ''
                        }`}
                    >
                      <span className="font-medium text-gray-700">
                        {own ? t('chat.you') : senderName}
                      </span>
                      <time>
                        {new Date(message.createdAt).toLocaleTimeString(i18n.language, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>

                    {/* Reply preview */}
                    {message.replyTo && (
                      <div
                        className={`mb-1.5 rounded-lg border-s-4 border-[#2563EB] bg-blue-50/70 px-3 py-2 text-xs ${own ? 'text-end' : ''
                          }`}
                      >
                        <p className="font-semibold text-[#1D4ED8]">
                          {message.replyTo.sender.name}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-gray-600">
                          {message.replyTo.body}
                        </p>
                      </div>
                    )}

                    <p
                      className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm ${own
                        ? 'rounded-ee-sm bg-[#2563EB] text-white'
                        : 'rounded-es-sm bg-gray-100 text-gray-800'
                        }`}
                    >
                      {message.body}
                    </p>

                    {/* Task mention cards */}
                    {message.taskMentionIds && message.taskMentionIds.length > 0 && (
                      <TaskMentionCards taskIds={message.taskMentionIds} />
                    )}

                    {/* Actions */}
                    <div
                      className={`mt-1 flex gap-2 text-[10px] text-gray-400 ${own ? 'justify-end' : ''
                        }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setReplyTo(message);
                          textareaRef.current?.focus();
                        }}
                        className="inline-flex items-center gap-1 hover:text-[#2563EB]"
                      >
                        <Reply className="size-3" /> Reply
                      </button>
                    </div>

                    {/* Receipts (for own messages) */}
                    {own && message.receipts?.length ? (
                      <div className="mt-1 flex flex-wrap items-center justify-end gap-x-2 text-[10px] text-gray-500">
                        {message.receipts.some((r) => r.readAt) ? (
                          <CheckCheck className="size-3.5 text-blue-600" />
                        ) : message.receipts.some((r) => r.deliveredAt) ? (
                          <CheckCheck className="size-3.5" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        <span>
                          {t('chat.deliveredCount', {
                            count: message.receipts.filter((r) => r.deliveredAt).length,
                            total: message.receipts.length,
                          })}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {/* Typing indicator */}
            {typingUsers.size > 0 && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="flex gap-1">
                  <span className="size-1.5 animate-bounce rounded-full bg-gray-400" />
                  <span
                    className="size-1.5 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: '0.1s' }}
                  />
                  <span
                    className="size-1.5 animate-bounce rounded-full bg-gray-400"
                    style={{ animationDelay: '0.2s' }}
                  />
                </span>
                <span>
                  {[...typingUsers]
                    .map((id) => members.find((m) => m.user.id === id)?.user.name)
                    .filter(Boolean)
                    .join(', ')}{' '}
                  {typingUsers.size === 1 ? 'is' : 'are'} typing…
                </span>
              </div>
            )}

            <div ref={bottom} />
          </div>

          {/* Reply bar */}
          {replyTo && (
            <div className="flex items-center gap-2 border-t border-gray-200 bg-blue-50/50 px-3 py-2">
              <div className="min-w-0 flex-1 border-s-4 border-[#2563EB] ps-3">
                <p className="text-xs font-semibold text-[#1D4ED8]">
                  Replying to {replyTo.sender.name}
                </p>
                <p className="truncate text-xs text-gray-600">{replyTo.body}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
              >
                <X className="size-4" />
              </button>
            </div>
          )}

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) send.mutate(body.trim());
            }}
            className="relative flex gap-2 border-t border-gray-200 p-3 sm:p-4"
          >
            {/* Task picker */}
            {taskPickerOpen && (
              <div className="absolute bottom-full start-4 z-10 mb-1 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                <div className="border-b border-gray-100 p-2">
                  <input
                    autoFocus
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    placeholder="Search tasks by # or title…"
                    className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <TaskSearchResults query={taskSearch} onPick={insertTask} />
                </div>
              </div>
            )}

            {/* Mention suggestions */}
            {suggestions.length > 0 && (
              <div className="absolute bottom-full start-4 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                {suggestions.map((m) => (
                  <button
                    key={m.user.id}
                    type="button"
                    onClick={() => chooseMention(m.user)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-blue-50"
                  >
                    <AtSign className="size-3.5 text-blue-600" />
                    {m.user.name}
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setTaskPickerOpen((v) => !v)}
              className="grid size-10 shrink-0 place-items-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
              title="Mention a task"
            >
              <Hash className="size-4" />
            </button>

            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                notifyTyping();
              }}
              onBlur={stopTyping}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (body.trim()) send.mutate(body.trim());
                }
              }}
              maxLength={3000}
              rows={1}
              placeholder="Type a message… use @ for mentions, # for tasks"
              className={`${input} min-h-10 resize-y`}
            />

            <button
              className={btnPrimary}
              type="submit"
              disabled={!body.trim() || send.isPending}
              aria-label={t('chat.send')}
            >
              <Send className="size-4" />
            </button>
          </form>

          {send.error && (
            <p role="alert" className="px-4 pb-3 text-sm text-red-600">
              {(send.error as Error).message}
            </p>
          )}
        </div>
      </section>

      {/* New chat modal */}
      {newChatOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNewChatOpen(false);
          }}
        >
          <section className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
            <header className="flex items-start justify-between gap-4 border-b border-gray-100 p-5">
              <div>
                <h2 className="font-semibold">{t('chat.startPrivateChat')}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('chat.chooseTeammate')}</p>
              </div>
              <button
                type="button"
                onClick={() => setNewChatOpen(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                <X className="size-4" />
              </button>
            </header>
            {/* <div className="max-h-[60vh] overflow-y-auto p-2">
              {members.map((member) => {
                const presence = presenceLabel(member.user.lastSeenAt, member.user.isOnline);
                return (
                  <button
                    key={member.user.id}
                    type="button"
                    onClick={() => {
                      selectChat(member.user.id);
                      setNewChatOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl p-3 text-start hover:bg-blue-50"
                  >
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-blue-100 font-semibold text-blue-700">
                      {member.user.name.slice(0, 1).toUpperCase()}
                      <span
                        className={`absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-white ${presence.online ? 'bg-emerald-500' : 'bg-gray-300'
                          }`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {member.user.name}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {[presence.label, t(`auth.${member.role?.toLowerCase() ?? 'member'}`)].join(' · ')}
                      </span>
                    </span>
                    <MessageCircle className="size-4 shrink-0 text-blue-600" />
                  </button>
                );
              })}
            </div> */}
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {membersQuery.isLoading && (
                <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p>
              )}
              {!membersQuery.isLoading && allMembers.length === 0 && (
                <p className="p-4 text-sm text-gray-500">{t('chat.noTeammates')}</p>
              )}

              {allMembers.map((member) => {
                const presence = presenceLabel(member.user.lastSeenAt, member.user.isOnline);
                const existingConv = conversations.find((c) => c.userId === member.user.id);

                return (
                  <button
                    key={member.user.id}
                    type="button"
                    onClick={() => {
                      selectChat(member.user.id);
                      setNewChatOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl p-3 text-start hover:bg-blue-50"
                  >
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-blue-100 font-semibold text-blue-700">
                      {member.user.name.slice(0, 1).toUpperCase()}
                      <span
                        className={`absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-white ${presence.online ? 'bg-emerald-500' : 'bg-gray-300'
                          }`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {member.user.name}
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {existingConv
                          ? existingConv.lastMessage.slice(0, 50)
                          : [presence.label, t(`auth.${member.role?.toLowerCase() ?? 'member'}`)].join(' · ')}
                      </span>
                    </span>
                    {existingConv && existingConv.unread > 0 && (
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#2563EB] text-[10px] font-bold text-white">
                        {existingConv.unread}
                      </span>
                    )}
                    <MessageCircle className="size-4 shrink-0 text-blue-600" />
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TASK MENTION CARDS — تظهر تحت الرسالة
// ============================================================
function TaskMentionCards({ taskIds }: { taskIds: string[] }) {
  const { data } = useQuery({
    queryKey: ['task-mentions', taskIds.join(',')],
    queryFn: () => apiClient.get<{ items: TaskOption[] }>(`/tasks?ids=${taskIds.join(',')}&pageSize=10`),
    enabled: taskIds.length > 0,
    staleTime: 60_000,
  });

  const tasks = data?.items ?? [];
  if (!tasks.length) return null;

  const statusColor: Record<string, string> = {
    BACKLOG: 'text-slate-600',
    TODO: 'text-slate-600',
    IN_PROGRESS: 'text-blue-600',
    IN_REVIEW: 'text-amber-600',
    BLOCKED: 'text-red-600',
    DONE: 'text-emerald-600',
  };

  return (
    <div className="mt-2 space-y-1.5">
      {tasks.map((task) => (
        <a
          key={task.id}
          href={`/tasks/${task.id}`}
          className="block rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 text-start transition hover:bg-blue-50"
        >
          <p className="text-xs font-semibold text-[#1D4ED8]">#{task.reference}</p>
          <p className="mt-0.5 truncate text-sm text-gray-800">{task.title}</p>
          <p className="mt-0.5 text-[10px]">
            <span className={statusColor[task.status] ?? 'text-gray-500'}>
              {task.status?.replace('_', ' ')}
            </span>
            <span className="text-gray-400"> · {task.priority}</span>
          </p>
        </a>
      ))}
    </div>
  );
}

// ============================================================
// TASK SEARCH RESULTS — داخل الـ Picker
// ============================================================
function TaskSearchResults({
  query,
  onPick,
}: {
  query: string;
  onPick: (task: TaskOption) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['task-search', query],
    queryFn: () => apiClient.get<TaskOption[]>(`/chat/tasks/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 1,
  });

  if (query.length === 0) {
    return <p className="p-3 text-xs text-gray-400">Type to search…</p>;
  }
  if (isLoading) {
    return <p className="p-3 text-xs text-gray-400">Searching…</p>;
  }
  if (!data?.length) {
    return <p className="p-3 text-xs text-gray-400">No tasks found.</p>;
  }

  return (
    <>
      {data.map((task) => (
        <button
          key={task.id}
          type="button"
          onClick={() => onPick(task)}
          className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-blue-50"
        >
          <Hash className="size-3.5 text-blue-600" />
          <span className="truncate">
            #{task.reference} {task.title}
          </span>
        </button>
      ))}
    </>
  );
}