import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../lib/api.js';

const createSchema = (t) => z.object({
    title: z.string().min(2, t('tasks.titleMinLength')).max(200),
    description: z.string().max(10_000).optional(),
    priority: z.enum(['URGENT', 'HIGH', 'MEDIUM', 'LOW']),
    status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE']),
    assigneeIds: z.array(z.string()).default([]),
    workstreamId: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    estimatedHrs: z.coerce.number().min(0).max(9999).nullable().optional(),
    tagNames: z.string().optional(),
});

export function QuickCreateTask({ onClose }) {
    const { t } = useTranslation();
    const qc = useQueryClient();
    const [createAnother, setCreateAnother] = useState(false);

    const { data: members } = useQuery({
        queryKey: ['members'],
        queryFn: () => apiClient.get('/members'),
    });
    const { data: workstreams } = useQuery({
        queryKey: ['workstreams'],
        queryFn: () => apiClient.get('/workstreams'),
    });

    const form = useForm({
        resolver: zodResolver(createSchema(t)),
        defaultValues: { priority: 'MEDIUM', status: 'TODO', assigneeIds: [] },
    });

    const mutation = useMutation({
        mutationFn: (values) =>
            apiClient.post('/tasks', {
                ...values,
                workstreamId: values.workstreamId || null,
                startDate: values.startDate ? new Date(values.startDate).toISOString() : null,
                dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : null,
                estimatedHrs: values.estimatedHrs ?? null,
                tagNames: values.tagNames?.split(',').map((t) => t.trim()).filter(Boolean) ?? [],
                links: values.links ? values.links.split(',').map((l) => l.trim()).filter(Boolean) : [], // ⬅️ هنا
            }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['tasks'] });
            void qc.invalidateQueries({ queryKey: ['board'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
            if (createAnother) form.reset({ ...form.getValues(), title: '', description: '' });
            else onClose();
        },
    });

    const error = mutation.error;

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
            <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">{t('tasks.create')}</h2>
                    <button onClick={onClose} aria-label={t('common.close')}><X className="size-5" /></button>
                </div>

                {error && (
                    <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                        {error.message ?? t('tasks.createError')}
                    </div>
                )}

                <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
                    <Field label={t('tasks.title')} error={form.formState.errors.title?.message}>
                        <input {...form.register('title')} className={input} placeholder={t('tasks.titlePlaceholder')} autoFocus />
                    </Field>

                    <Field label={t('tasks.description')}>
                        <textarea {...form.register('description')} rows={3} className={input} placeholder={t('tasks.descriptionPlaceholder')} />
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t('tasks.priority')}>
                            <select {...form.register('priority')} className={input}>
                                {['URGENT', 'HIGH', 'MEDIUM', 'LOW'].map((priority) => <option key={priority} value={priority}>{t(`priority.${priority}`)}</option>)}
                            </select>
                        </Field>
                        <Field label={t('tasks.status')}>
                            <select {...form.register('status')} className={input}>
                                {['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'].map((s) => (
                                    <option key={s} value={s}>{t(`status.${s}`)}</option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <Field label={t('tasks.assignees')} hint={t('tasks.assigneesHint')}>
                        <select {...form.register('assigneeIds')} multiple className={`${input} h-32`}>
                            {members?.map((m) => (
                                <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
                            ))}
                        </select>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-3">
                        <Field label={t('tasks.startDate')}>
                            <input type="date" {...form.register('startDate')} className={input} />
                        </Field>
                        <Field label={t('tasks.deadline')} error={form.formState.errors.dueDate?.message}>
                            <input type="date" {...form.register('dueDate')} className={input} />
                        </Field>
                        <Field label={t('tasks.estimatedHours')}>
                            <input type="number" step="0.5" min="0" {...form.register('estimatedHrs')} className={input} />
                        </Field>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t('tasks.workstream')}>
                            <select {...form.register('workstreamId')} className={input}>
                                <option value="">{t('common.none')}</option>
                                {workstreams?.map((w) => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                            </select>
                        </Field>
                        <Field label={t('tasks.tags')} hint={t('tasks.commaSeparated')}>
                            <input {...form.register('tagNames')} className={input} placeholder={t('tasks.tagsPlaceholder')} />
                        </Field>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                        <label className="me-auto flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                            <input type="checkbox" checked={createAnother} onChange={(e) => setCreateAnother(e.target.checked)} />
                            {t('tasks.createAnother')}
                        </label>
                     
                            <Field label="Relevant Links" hint="Comma separated (e.g. https://github.com/... , https://figma.com/...)">
                                <input
                                    {...form.register('links')}
                                    className={input}
                                    placeholder="https://..., https://..."
                                />
                            </Field>
                        <button type="button" onClick={onClose} className={btnSecondary}>{t('tasks.cancel')}</button>
                        <button type="submit" disabled={mutation.isPending} className={btnPrimary}>
                            {mutation.isPending ? t('tasks.saving') : t('tasks.create')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export const input =
    'w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[13px] outline-none transition placeholder:text-gray-400 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';
export const btnPrimary =
    'rounded-md bg-[#2563EB] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#1D4ED8] disabled:opacity-50';
export const btnSecondary =
    'rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-medium transition hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700';
export const btnDanger =
    'rounded-md bg-red-500 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-red-600 disabled:opacity-50';

export function Field({ label, hint, error, children }) {
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-medium">{label}</span>
            {children}
            {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
            {error && (
                <span className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">{error}</span>
            )}
        </label>
    );
}
