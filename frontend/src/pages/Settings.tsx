import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useAuth } from '../lib/auth';
import { apiClient } from '../lib/api';
import { btnPrimary, input } from '../components/QuickCreateTask';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { user, workspaceId, refreshMe } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const ownMembership = user?.memberships.find((membership: any) => membership.workspace.id === workspaceId);
  const currentTags = ownMembership?.specialties?.length ? ownMembership.specialties : ownMembership?.specialty ? [ownMembership.specialty] : [];
  const [tags, setTags] = useState(currentTags.join(', '));
  useEffect(() => setTags(currentTags.join(', ')), [user, workspaceId]);
  const saveName = useMutation({
    mutationFn: () => apiClient.patch('/auth/me', { name: name.trim() }),
    onSuccess: () => refreshMe(),
  });
  const saveTags = useMutation({
    mutationFn: () => apiClient.patch('/members/me/tags', { specialties: [...new Set(tags.split(',').map((tag) => tag.trim()).filter(Boolean))] }),
    onSuccess: () => refreshMe(),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500">{t('settings.subtitle')}</p>
      </header>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="font-semibold">{t('settings.profile')}</h2>
        <form onSubmit={(event) => { event.preventDefault(); saveName.mutate(); }} className="space-y-2">
          <label htmlFor="profile-name" className="block text-xs text-gray-500">{t('settings.displayName')}</label>
          <div className="flex flex-wrap gap-2">
            <input id="profile-name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className={`${input} min-w-0 flex-1`} />
            <button type="submit" disabled={saveName.isPending || name.trim() === user?.name} className={btnPrimary}>{saveName.isPending ? t('common.loading') : t('common.save')}</button>
          </div>
          {saveName.isSuccess && <p role="status" className="text-sm text-green-700">{t('settings.profileSaved')}</p>}
          {saveName.isError && <p role="alert" className="text-sm text-red-600">{(saveName.error as Error).message}</p>}
        </form>
        <form onSubmit={(event) => { event.preventDefault(); saveTags.mutate(); }} className="space-y-2 border-t border-gray-100 pt-4">
          <label htmlFor="profile-tags" className="block text-xs text-gray-500">{t('settings.specialties')}</label>
          <div className="flex flex-wrap gap-2">
            <input id="profile-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t('team.tagsPlaceholder')} className={`${input} min-w-0 flex-1`} />
            <button type="submit" disabled={saveTags.isPending} className={btnPrimary}>{saveTags.isPending ? t('common.loading') : t('common.save')}</button>
          </div>
          <p className="text-xs text-gray-500">{t('settings.specialtiesHint')}</p>
          {saveTags.isSuccess && <p role="status" className="text-sm text-green-700">{t('settings.specialtiesSaved')}</p>}
          {saveTags.isError && <p role="alert" className="text-sm text-red-600">{(saveTags.error as Error).message}</p>}
        </form>
        <div>
          <p className="text-xs text-gray-500">{t('auth.email')}</p>
          <p className="font-medium">{user?.email}</p>
        </div>
        {user?.jobTitle && <div>
          <p className="text-xs text-gray-500">{t('settings.jobTitle')}</p>
          <p className="font-medium">{user.jobTitle}</p>
        </div>}
      </section>

      <section className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h2 className="font-semibold">{t('settings.language')}</h2>
          <p className="text-sm text-gray-500">{i18n.language === 'ar' ? 'العربية' : 'English'}</p>
        </div>
        <LanguageSwitcher />
      </section>

    </div>
  );
}
