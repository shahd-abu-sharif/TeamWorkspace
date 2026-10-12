import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Mail, Pencil, Plus, UserPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api';
import { btnPrimary, btnSecondary, input } from '../components/QuickCreateTask';

interface Member {
  id: string;
  role: string;
  isActive: boolean;
  specialty?: string | null;
  specialties?: string[];
  user: { id: string; name: string; email: string; lastLoginAt?: string | null };
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

const parseTags = (value: string) => [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];
const memberTags = (member: Member) => member.specialties?.length ? member.specialties : parseTags(member.specialty ?? '');

export function TeamPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [inviteTags, setInviteTags] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [message, setMessage] = useState('');

  const { data: members = [], isLoading: loadingMembers } = useQuery({
    queryKey: ['members'],
    queryFn: () => apiClient.get<Member[]>('/members'),
  });
  const { data: invitations = [] } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => apiClient.get<Invitation[]>('/auth/invitations'),
  });

  const tagSuggestions = useMemo(() => [...new Set(members.flatMap(memberTags))].sort(), [members]);
  const invite = useMutation({
    mutationFn: () => apiClient.post<{ acceptUrl: string }>('/auth/invitations', {
      email: email.trim(), role: 'MEMBER', specialties: parseTags(inviteTags),
    }),
    onSuccess: (result) => {
      const url = new URL(result.acceptUrl, window.location.origin).href;
      setInviteEmail(email.trim());
      setInviteUrl(url);
      setMessage(t('team.inviteCreated'));
      setEmail('');
      setInviteTags('');
      void queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.post(`/auth/invitations/${id}/revoke`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });
  const removeMember = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/members/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members'] }),
  });

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage(t('team.linkCopied'));
    } catch {
      setMessage(inviteUrl);
    }
  };

  const activeMembers = members.filter((member) => member.isActive);
  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header>
        <h1 className="text-2xl font-semibold">{t('team.title')}</h1>
        <p className="mt-2 text-sm text-gray-500">{t('team.subtitle')}</p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center gap-3">
          <UserPlus className="size-5 text-[#2563EB]" />
          <h2 className="font-semibold">{t('team.addMember')}</h2>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); setInviteUrl(''); invite.mutate(); }} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
            {t('auth.email')}
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('team.emailPlaceholder')} className={`${input} w-full`} />
          </label>
          <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
            {t('team.memberTags')}
            <input value={inviteTags} onChange={(event) => setInviteTags(event.target.value)} list="team-tag-suggestions" placeholder={t('team.tagsPlaceholder')} className={`${input} w-full`} />
            <span className="block text-xs font-normal text-gray-500">{t('team.tagsHint')}</span>
          </label>
          <datalist id="team-tag-suggestions">{tagSuggestions.map((tag) => <option key={tag} value={tag} />)}</datalist>
          <button type="submit" disabled={invite.isPending} className={`${btnPrimary} sm:col-span-2 sm:justify-self-start`}>
            {invite.isPending ? t('team.creatingInvite') : t('team.createInvite')}
          </button>
        </form>
        <p className="mt-3 text-xs text-gray-500">{t('team.inviteExplanation')}</p>
        {message && <p role="status" className="mt-3 break-all text-sm text-gray-600">{message}</p>}
        {inviteUrl && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-blue-50 p-4">
          <a href={inviteUrl} className="min-w-0 flex-1 break-all text-sm text-[#1D4ED8] underline">{inviteUrl}</a>
          <button type="button" onClick={() => void copyInvite()} className={btnSecondary}><Copy className="me-1 inline size-4" />{t('team.copyLink')}</button>
          <a href={`mailto:${inviteEmail}?subject=${encodeURIComponent(t('team.emailSubject'))}&body=${encodeURIComponent(t('team.emailBody', { url: inviteUrl }))}`} className={btnSecondary}><Mail className="me-1 inline size-4" />{t('team.openEmail')}</a>
        </div>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t('team.members')}</h2>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#2563EB]">{t('team.memberCount', { count: activeMembers.length })}</span>
        </div>
        <p className="mb-4 text-sm text-gray-500">{t('team.memberTagsHint')}</p>
        {loadingMembers ? <p className="py-5 text-sm text-gray-500">{t('common.loading')}</p> : <ul className="divide-y divide-gray-100">
          {members.map((member) => <MemberRow key={member.id} member={member} suggestions={tagSuggestions} onRemove={() => removeMember.mutate(member.id)} />)}
        </ul>}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 font-semibold">{t('team.pendingInvitations')}</h2>
        {invitations.length === 0 ? <p className="text-sm text-gray-500">{t('team.noInvitations')}</p> : <ul className="divide-y divide-gray-100">
          {invitations.map((invitation) => <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{invitation.email}</p><p className="mt-1 text-xs text-gray-500">{t(`team.status.${invitation.status}`)} · {new Date(invitation.expiresAt).toLocaleDateString()}</p></div>
            {invitation.status === 'PENDING' && <button type="button" onClick={() => revoke.mutate(invitation.id)} className="text-sm text-red-600 hover:underline">{t('team.revoke')}</button>}
          </li>)}
        </ul>}
      </section>
    </div>
  );
}

function MemberRow({ member, suggestions, onRemove }: { member: Member; suggestions: string[]; onRemove: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memberTags(member).join(', '));
  const tags = memberTags(member);
  const save = useMutation({
    mutationFn: () => apiClient.patch(`/members/${member.id}`, { specialties: parseTags(value), specialty: null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      setEditing(false);
    },
  });
  const addTag = (tag: string) => {
    if (!tag || parseTags(value).some((current) => current.toLowerCase() === tag.toLowerCase())) return;
    setValue([...parseTags(value), tag].join(', '));
  };

  return <li className="flex flex-wrap items-start gap-3 py-4">
    <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-blue-100 font-semibold text-[#2563EB]">{member.user.name.slice(0, 1).toUpperCase()}</div>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{member.user.name}</p>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">{t(`auth.${member.role.toLowerCase()}`)}</span>
      </div>
      <p className="mt-1 text-sm text-gray-500">{member.user.email}</p>
      {editing ? <div className="mt-3 space-y-2">
        <input value={value} onChange={(event) => setValue(event.target.value)} list={`tags-${member.id}`} placeholder={t('team.tagsPlaceholder')} className={`${input} w-full max-w-xl`} />
        <datalist id={`tags-${member.id}`}>{suggestions.map((tag) => <option key={tag} value={tag} />)}</datalist>
        <div className="flex flex-wrap gap-2">{suggestions.map((tag) => <button key={tag} type="button" onClick={() => addTag(tag)} className="rounded-full border border-blue-200 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50"><Plus className="me-1 inline size-3" />{tag}</button>)}</div>
        <div className="flex gap-2">
          <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className={btnPrimary}><Check className="me-1 inline size-4" />{t('common.save')}</button>
          <button type="button" onClick={() => { setValue(tags.join(', ')); setEditing(false); }} className={btnSecondary}>{t('common.cancel')}</button>
          {save.isError && <span role="alert" className="self-center text-xs text-red-600">{(save.error as Error).message}</span>}
        </div>
      </div> : <div className="mt-3 flex flex-wrap items-center gap-2">
        {tags.length ? tags.map((tag) => <span key={tag} className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{tag}</span>) : <span className="text-xs text-gray-400">{t('team.noTags')}</span>}
        <button type="button" onClick={() => { setValue(tags.join(', ')); setEditing(true); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"><Pencil className="size-3" />{t('team.editTags')}</button>
      </div>}
    </div>
    {member.role !== 'LEADER' && <button type="button" onClick={onRemove} className="rounded-md p-2 text-red-600 hover:bg-red-50" aria-label={t('team.removeMember')} title={t('team.removeMember')}><X className="size-4" /></button>}
  </li>;
}
