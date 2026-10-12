// apps/web/src/pages/AcceptInvite.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../lib/api';
import { Field, btnPrimary, input } from '../components/QuickCreateTask';
import { useTranslation } from 'react-i18next';

interface Preview {
    email: string;
    role: string;
    specialty?: string | null;
    specialties?: string[];
    workspace: { name: string };
}

export function AcceptInvitePage() {
    const { t } = useTranslation();
    const [params] = useSearchParams();
    const token = params.get('token') ?? '';
    const navigate = useNavigate();
    const [preview, setPreview] = useState<Preview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!token) return setError(t('auth.inviteMissingToken'));
        apiClient
            .get<Preview>(`/auth/invitations/preview?token=${encodeURIComponent(token)}`, { skipAuth: true })
            .then((data) => {
                setPreview(data);
                setName(data.email.split('@')[0]);
            })
            .catch((err) => setError(err.message));
    }, [token, t]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await apiClient.post(
                '/auth/register',
                { token, name, password },
                { skipAuth: true },
            );
            navigate('/login', { replace: true });
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setBusy(false);
        }
    };

    if (error) {
        return (
            <div className="grid min-h-dvh place-items-center p-4">
                <div className="max-w-sm rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/40">
                    <p className="font-semibold text-red-700 dark:text-red-300">{t('auth.invitationProblem')}</p>
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
            </div>
        );
    }

    if (!preview) return <div className="grid min-h-dvh place-items-center text-sm text-slate-500">{t('common.loading')}</div>;

    return (
        <div className="grid min-h-dvh place-items-center bg-slate-50 p-4 dark:bg-slate-950">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h1 className="text-lg font-semibold">{t('auth.joinWorkspace', { name: preview.workspace.name })}</h1>
                <p className="mt-1 text-sm text-slate-500">
                    {t('auth.invitedAs')} <span className="font-medium text-[#2563EB]">{t(`auth.${preview.role.toLowerCase()}`)}</span>
                    {(preview.specialties?.length ? preview.specialties.join(', ') : preview.specialty) ? ` · ${preview.specialties?.length ? preview.specialties.join(', ') : preview.specialty}` : ''}
                </p>

                <form onSubmit={submit} className="mt-6 space-y-4">
                    <Field label={t('auth.email')}>
                        <input value={preview.email} disabled className={`${input} bg-slate-100 dark:bg-slate-800`} />
                    </Field>
                    <Field label={t('auth.yourName')}>
                        <input required value={name} onChange={(e) => setName(e.target.value)} className={input} />
                    </Field>
                    <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
                        <input
                            type="password"
                            required
                            minLength={10}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={input}
                            autoComplete="new-password"
                        />
                    </Field>
                    <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
                        {busy ? t('auth.creatingAccount') : t('auth.createAccount')}
                    </button>
                </form>
            </div>
        </div>
    );
}
