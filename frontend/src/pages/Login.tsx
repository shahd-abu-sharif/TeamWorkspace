// apps/web/src/pages/Login.tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Field, btnPrimary, input } from '../components/QuickCreateTask';
import { useTranslation } from 'react-i18next';

export function LoginPage() {
    const { t } = useTranslation();
    const { login } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await login(email, password);
            navigate('/', { replace: true });
        } catch (err) {
            setError((err as Error).message || t('auth.signInFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="grid min-h-dvh place-items-center bg-slate-50 p-4 dark:bg-slate-950">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-6 text-center">
                    <img src="/Tadreeby%20Emblem.svg" alt="Tadreeby" className="mx-auto mb-3 h-auto w-20" />
                    <h1 className="text-xl font-semibold">Tadreeby Team Hub</h1>
                    <p className="mt-1 text-sm text-slate-500">{t('auth.signInSubtitle')}</p>
                </div>

                {error && (
                    <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        {error}
                    </div>
                )}

                <form onSubmit={submit} className="space-y-4">
                    <Field label={t('auth.email')}>
                        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" />
                    </Field>
                    <Field label={t('auth.password')}>
                        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="current-password" />
                    </Field>
                    <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
                        {busy ? t('auth.signingIn') : t('auth.signIn')}
                    </button>
                </form>

                <div className="mt-4 text-center text-sm">
                    <Link to="/forgot-password" className="text-[#2563EB] hover:underline">{t('auth.forgotPassword')}</Link>
                </div>
                <p className="mt-6 text-center text-xs text-slate-500">
                    {t('auth.privateWorkspace')}
                </p>
            </div>
        </div>
    );
}
