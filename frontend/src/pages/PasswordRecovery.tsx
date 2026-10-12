import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Field, btnPrimary, input } from '../components/QuickCreateTask';
import { apiClient } from '../lib/api';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [resetUrl, setResetUrl] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    setResetUrl('');
    try {
      const result = await apiClient.post<{ ok: boolean; resetUrl?: string }>('/auth/forgot-password', { email }, { skipAuth: true });
      setMessage(t('auth.resetRequestSent'));
      if (result.resetUrl) setResetUrl(result.resetUrl);
    } catch (reason) {
      setError((reason as Error).message || t('auth.resetRequestFailed'));
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center">
    <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold">{t('auth.forgotPassword')}</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">{t('auth.resetRequestHint')}</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label={t('auth.email')}><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={input} autoComplete="email" /></Field>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy ? t('common.loading') : t('auth.sendResetLink')}</button>
      </form>
      {message && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {resetUrl && <a href={resetUrl} className="mt-3 block break-all text-sm text-[#2563EB] underline">{t('auth.openResetLink')}</a>}
      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      <Link to="/login" className="mt-6 inline-block text-sm text-[#2563EB] hover:underline">{t('common.backToLogin')}</Link>
    </section>
  </div>;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiClient.post('/auth/reset-password', { token, password }, { skipAuth: true });
      setMessage(t('auth.passwordReset'));
    } catch (reason) {
      setError((reason as Error).message || t('auth.passwordResetFailed'));
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center">
    <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-semibold">{t('auth.newPassword')}</h1>
      {!token ? <p role="alert" className="mt-4 text-sm text-red-600">{t('auth.resetTokenMissing')}</p> : <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label={t('auth.password')} hint={t('auth.passwordHint')}><input type="password" required minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} className={input} autoComplete="new-password" /></Field>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>{busy ? t('common.loading') : t('auth.resetPassword')}</button>
      </form>}
      {message && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
      <Link to="/login" className="mt-6 inline-block text-sm text-[#2563EB] hover:underline">{t('common.backToLogin')}</Link>
    </section>
  </div>;
}
