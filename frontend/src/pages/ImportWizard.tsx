// apps/web/src/pages/ImportWizard.tsx
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { apiClient } from '../lib/api';
import { btnPrimary, btnSecondary, input } from '../components/QuickCreateTask';
import { useTranslation } from 'react-i18next';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const APP_FIELDS = [
    ['title', 'fieldTitle'],
    ['description', 'fieldDescription'],
    ['assignee', 'fieldAssignee'],
    ['priority', 'fieldPriority'],
    ['status', 'fieldStatus'],
    ['startDate', 'fieldStartDate'],
    ['dueDate', 'fieldDeadline'],
    ['estimatedHrs', 'fieldEstimatedHours'],
    ['workstream', 'fieldWorkstream'],
    ['dependencies', 'fieldDependencies'],
    ['tags', 'fieldTags'],
] as const;

interface ParsedRow {
    rowNumber: number;
    title: string;
    priority: string;
    status: string;
    startDate: string | null;
    dueDate: string | null;
    estimatedHrs: number | null;
    workstreamName: string | null;
    assigneeUserId: string | null;
    suggestedUserId: string | null;
    assigneeRaw: string | null;
    tagNames: string[];
    dependencyRefs: string[];
    issues: { field?: string; message: string; severity: 'error' | 'warning' }[];
    valid: boolean;
    excluded?: boolean;
    description?: string | null;
}

export function ImportWizard({ onDone }: { onDone?: () => void }) {
    const { t } = useTranslation();
    const [step, setStep] = useState<Step>(1);
    const [file, setFile] = useState<File | null>(null);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const [sheets, setSheets] = useState<string[]>([]);
    const [sheetName, setSheetName] = useState('');
    const [headers, setHeaders] = useState<string[]>([]);
    const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({});

    const [draft, setDraft] = useState<{
        rows: ParsedRow[];
        summary: Record<string, number>;
        members: { id: string; name: string; email: string; specialty?: string | null }[];
    } | null>(null);

    const [summary, setSummary] = useState<{
        created: number; skipped: number; errors: number; unassigned: number;
        errorReport: { rowNumber: number; field: string | null; message: string }[];
    } | null>(null);

    // ------------------------------------------------------------ step 1

    const uploadFile = async (selected: File) => {
        setError(null);
        setFile(selected);
        setProgress(0);
        try {
            const parsed = await apiClient.upload<{
                sheetNames: string[]; sheetName: string; headers: string[];
                rows: Record<string, unknown>[]; totalRows: number;
                suggestedMapping: Record<string, string>;
            }>('/import/parse', selected, setProgress);

            setSheets(parsed.sheetNames);
            setSheetName(parsed.sheetName);
            setHeaders(parsed.headers);
            setRawRows(parsed.rows);
            setMapping(parsed.suggestedMapping);
            setStep(2);
        } catch (err) {
            setError((err as Error).message);
        }
    };

    const changeSheet = async (name: string) => {
        if (!file) return;
        setSheetName(name);
        const parsed = await apiClient.upload<{
            headers: string[]; rows: Record<string, unknown>[]; suggestedMapping: Record<string, string>;
        }>('/import/parse', file);
        setHeaders(parsed.headers);
        setRawRows(parsed.rows);
        setMapping(parsed.suggestedMapping);
    };

    // ------------------------------------------------------------ step 3-5

    const buildDraft = useMutation({
        mutationFn: () =>
            apiClient.post<{ rows: ParsedRow[]; summary: Record<string, number>; members: any[] }>(
                '/import/draft',
                { fileName: file!.name, sheetName, rows: rawRows, mapping },
            ),
        onSuccess: (data) => {
            setDraft(data);
            setStep(5);
        },
        onError: (err) => setError((err as Error).message),
    });

    const resolvedRows = useMemo(() => draft?.rows ?? [], [draft]);

    const updateRow = (rowNumber: number, patch: Partial<ParsedRow>) => {
        setDraft((prev) =>
            prev
                ? { ...prev, rows: prev.rows.map((r) => (r.rowNumber === rowNumber ? { ...r, ...patch } : r)) }
                : prev,
        );
    };

    // ------------------------------------------------------------ step 6-7

    const commit = useMutation({
        mutationFn: (mode: 'all' | 'valid') =>
            apiClient.post<typeof summary>('/import/commit', {
                fileName: file!.name,
                sheetName,
                mapping,
                rows: resolvedRows.map((r) => ({
                    ...r,
                    excluded: mode === 'valid' ? !r.valid || r.excluded : r.excluded,
                })),
            }),
        onSuccess: (data) => {
            setSummary(data);
            setStep(7);
        },
        onError: (err) => setError((err as Error).message),
    });

    const downloadErrors = () => {
        if (!summary) return;
        const csv = [
            'row,field,message',
            ...summary.errorReport.map((e) =>
                `${e.rowNumber},"${e.field ?? ''}","${e.message.replace(/"/g, '""')}"`,
            ),
        ].join('\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `import-errors-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-5">
            <header>
                <h1 className="text-2xl font-semibold">{t('import.title')}</h1>
            </header>
            <Stepper current={step} />

            {error && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {error}
                </div>
            )}

            {/* ---------------------------------------------------- step 1 */}
            {step === 1 && (
                <label
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                        e.preventDefault();
                        const dropped = e.dataTransfer.files[0];
                        if (dropped) void uploadFile(dropped);
                    }}
                    className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-12 text-center transition hover:border-[#2563EB] hover:bg-[#2563EB]/5 dark:border-slate-700 dark:bg-slate-900"
                >
                    <FileSpreadsheet className="size-10 text-[#2563EB]" />
                    <div>
                        <p className="font-medium">{t('import.dropzone')}</p>
                        <p className="mt-1 text-sm text-slate-500">{t('import.browse')}</p>
                    </div>
                    <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadFile(f);
                        }}
                    />
                    {progress > 0 && progress < 100 && (
                        <div className="mt-2 w-full max-w-xs">
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                                <div className="h-full bg-[#2563EB] transition-all" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="mt-1 text-xs text-slate-500">{t('import.uploading')} {progress}%</p>
                        </div>
                    )}
                </label>
            )}

            {/* ---------------------------------------------------- step 2 */}
            {step === 2 && (
                <section className="space-y-4">
                    <div className="flex flex-wrap items-end gap-4">
                        <label className="block">
                            <span className="mb-1 block text-sm font-medium">{t('import.worksheet')}</span>
                            <select value={sheetName} onChange={(e) => void changeSheet(e.target.value)} className={input}>
                                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </label>
                        <p className="text-sm text-slate-500">{t('import.dataRows', { count: rawRows.length })}</p>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full min-w-[600px] text-sm">
                            <thead className="bg-slate-50 text-start dark:bg-slate-900">
                                <tr>
                                    <th className="p-2 font-medium">#</th>
                                    {headers.slice(0, 8).map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {rawRows.slice(0, 8).map((row, i) => (
                                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                                        <td className="p-2 text-slate-400">{i + 2}</td>
                                        {headers.slice(0, 8).map((h) => (
                                            <td key={h} className="max-w-48 truncate p-2">{String(row[h] ?? '—')}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {rawRows.length > 8 && (
                            <p className="border-t border-slate-100 p-2 text-xs text-slate-500 dark:border-slate-800">
                                {t('import.previewRows', { count: rawRows.length })}
                            </p>
                        )}
                    </div>

                    <div className="flex justify-end gap-3">
                        <button onClick={() => setStep(1)} className={btnSecondary}>{t('common.back')}</button>
                        <button onClick={() => setStep(3)} className={btnPrimary}>{t('import.mapColumns')}</button>
                    </div>
                </section>
            )}

            {/* ---------------------------------------------------- step 3 */}
            {step === 3 && (
                <section className="space-y-4">
                    <p className="text-sm text-slate-500">
                        {t('import.mappingHelp')}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {APP_FIELDS.map(([field, label]) => (
                            <label key={field} className="block">
                                <span className="mb-1 block text-sm font-medium">{t(`import.${label}`)}</span>
                                <select
                                    value={mapping[field] ?? ''}
                                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                                    className={input}
                                >
                                    <option value="">{t('import.notMapped')}</option>
                                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                                </select>
                            </label>
                        ))}
                    </div>
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setStep(2)} className={btnSecondary}>{t('common.back')}</button>
                        <button
                            onClick={() => buildDraft.mutate()}
                            disabled={!mapping.title || buildDraft.isPending}
                            className={btnPrimary}
                        >
                            {buildDraft.isPending ? t('import.validating') : t('import.validateRows')}
                        </button>
                    </div>
                    {!mapping.title && <p className="text-end text-xs text-red-500">{t('import.titleMappingRequired')}</p>}
                </section>
            )}

            {/* ---------------------------------------------------- step 5: review */}
            {step === 5 && draft && (
                <section className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                        <Stat label={t('import.total')} value={draft.summary.total} />
                        <Stat label={t('import.valid')} value={draft.summary.valid} tone="good" />
                        <Stat label={t('import.warnings')} value={draft.summary.warnings} tone="warn" />
                        <Stat label={t('import.invalid')} value={draft.summary.invalid} tone="bad" />
                        <Stat label={t('import.unmatchedAssignees')} value={draft.summary.unresolvedAssignees} tone="warn" />
                    </div>

                    <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                        <table className="w-full min-w-[900px] text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-start dark:bg-slate-900">
                                <tr>
                                    <th className="p-2">{t('import.include')}</th>
                                    <th className="p-2">{t('import.row')}</th>
                                    <th className="p-2">{t('tasks.title')}</th>
                                    <th className="p-2">{t('tasks.assignees')}</th>
                                    <th className="p-2">{t('tasks.priority')}</th>
                                    <th className="p-2">{t('tasks.deadline')}</th>
                                    <th className="p-2">{t('import.issues')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {resolvedRows.map((row) => (
                                    <tr
                                        key={row.rowNumber}
                                        className={`border-t border-slate-100 dark:border-slate-800 ${!row.valid ? 'bg-red-50/60 dark:bg-red-950/20' : ''
                                            }`}
                                    >
                                        <td className="p-2">
                                            <input
                                                type="checkbox"
                                                checked={!row.excluded}
                                                onChange={(e) => updateRow(row.rowNumber, { excluded: !e.target.checked })}
                                            />
                                        </td>
                                        <td className="p-2 text-slate-400">{row.rowNumber}</td>
                                        <td className="p-2">
                                            <input
                                                value={row.title}
                                                onChange={(e) => updateRow(row.rowNumber, { title: e.target.value })}
                                                className="w-56 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-200 focus:border-[#2563EB] focus:outline-none dark:hover:border-slate-700"
                                            />
                                        </td>
                                        <td className="p-2">
                                            {row.assigneeRaw ? (
                                                <select
                                                    value={row.assigneeUserId ?? ''}
                                                    onChange={(e) => updateRow(row.rowNumber, { assigneeUserId: e.target.value || null })}
                                                    className={`rounded border px-1 py-0.5 text-xs ${row.assigneeUserId
                                                            ? 'border-transparent bg-transparent'
                                                            : 'border-[#FCA840] bg-[#FCA840]/10'
                                                        }`}
                                                >
                                                    <option value="">{t('import.leaveUnassigned')}</option>
                                                    {draft.members.map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.name} ({m.email})
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <span className="text-xs text-slate-400">—</span>
                                            )}
                                            {!row.assigneeUserId && row.suggestedUserId && (
                                                <p className="mt-0.5 text-[10px] text-[#b45309]">
                                                    {t('import.suggestedAssignee', { name: draft.members.find((m) => m.id === row.suggestedUserId)?.name })}
                                                </p>
                                            )}
                                        </td>
                                        <td className="p-2 text-xs">{row.priority}</td>
                                        <td className="p-2 text-xs">
                                            {row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '—'}
                                        </td>
                                        <td className="max-w-64 p-2">
                                            {row.issues.map((issue, i) => (
                                                <p
                                                    key={i}
                                                    className={`flex items-start gap-1 text-[11px] ${issue.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-[#b45309]'
                                                        }`}
                                                >
                                                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                                    {issue.message}
                                                </p>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex flex-wrap justify-end gap-3">
                        <button onClick={() => setStep(3)} className={btnSecondary}>{t('common.back')}</button>
                        <button onClick={() => commit.mutate('valid')} disabled={commit.isPending} className={btnSecondary}>
                            {t('import.importValid')} ({draft.summary.valid})
                        </button>
                        <button onClick={() => commit.mutate('all')} disabled={commit.isPending} className={btnPrimary}>
                            {commit.isPending ? t('import.importing') : `${t('import.importAll')} (${resolvedRows.filter((r) => !r.excluded).length})`}
                        </button>
                    </div>
                </section>
            )}

            {/* ---------------------------------------------------- step 7: summary */}
            {step === 7 && summary && (
                <section className="space-y-5">
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
                        <CheckCircle2 className="size-6 text-emerald-600" />
                        <div>
                            <p className="font-semibold text-emerald-800 dark:text-emerald-300">{t('import.complete')}</p>
                            <p className="text-sm text-emerald-700 dark:text-emerald-400">
                                {t('import.completeDescription')}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Stat label={t('import.created')} value={summary.created} tone="good" />
                        <Stat label={t('import.skipped')} value={summary.skipped} />
                        <Stat label={t('import.errors')} value={summary.errors} tone={summary.errors ? 'bad' : undefined} />
                        <Stat label={t('import.unassigned')} value={summary.unassigned} tone="warn" />
                    </div>

                    {summary.errorReport.length > 0 && (
                        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                            <div className="mb-3 flex items-center justify-between">
                                <p className="font-medium">{t('import.failedRows')}</p>
                                <button onClick={downloadErrors} className={btnSecondary}>
                                    <Download className="me-1 inline size-4" /> {t('import.downloadCsv')}
                                </button>
                            </div>
                            <ul className="max-h-52 space-y-1 overflow-y-auto text-sm">
                                {summary.errorReport.map((e, i) => (
                                    <li key={i} className="flex gap-2 text-red-600 dark:text-red-400">
                                        <span className="text-slate-400">{t('import.rowNumber', { row: e.rowNumber })}</span>
                                        <span>{e.message}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={() => {
                                setStep(1);
                                setFile(null);
                                setDraft(null);
                                setSummary(null);
                                setProgress(0);
                            }}
                            className={btnSecondary}
                        >
                            {t('import.anotherFile')}
                        </button>
                        <button onClick={onDone} className={btnPrimary}>{t('common.done')}</button>
                    </div>
                </section>
            )}
        </div>
    );
}

function Stepper({ current }: { current: number }) {
    const { t } = useTranslation();
    const labels = ['uploadStep', 'previewStep', 'mapColumns', 'reviewStep', 'confirmStep', 'summaryStep'].map((key) => t(`import.${key}`));
    const index = current === 1 ? 0 : current === 2 ? 1 : current === 3 ? 2 : current === 5 ? 3 : current === 7 ? 5 : 4;
    return (
        <ol className="flex flex-wrap items-center gap-2 text-xs">
            {labels.map((label, i) => (
                <li key={label} className="flex items-center gap-2">
                    <span
                        className={`grid size-6 place-items-center rounded-full font-semibold ${i < index
                                ? 'bg-emerald-500 text-white'
                                : i === index
                                    ? 'bg-[#2563EB] text-white'
                                    : 'bg-slate-200 text-slate-500 dark:bg-slate-800'
                            }`}
                    >
                        {i + 1}
                    </span>
                    <span className={i === index ? 'font-medium' : 'text-slate-500'}>{label}</span>
                    {i < labels.length - 1 && <span className="mx-1 text-slate-300">›</span>}
                </li>
            ))}
        </ol>
    );
}

function Stat({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: 'good' | 'warn' | 'bad';
}) {
    const color =
        tone === 'good'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'warn'
                ? 'text-[#b45309] dark:text-[#FCA840]'
                : tone === 'bad'
                    ? 'text-red-600 dark:text-red-400'
                    : '';
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
        </div>
    );
}
