import { useRef, useState } from 'react';
import { Bold, Italic, Code, Link as LinkIcon, List, Table as TableIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parseDelimited, tableSkeleton, toMarkdownTable } from '../lib/table';

const TOOLBAR_BUTTON =
    'p-1.5 text-slate-500 hover:bg-slate-200 rounded dark:hover:bg-slate-700 disabled:opacity-40';

export function MarkdownEditor({
    value,
    onChange,
    placeholder,
}: {
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
}) {
    const { t } = useTranslation();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [tableOpen, setTableOpen] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [columns, setColumns] = useState(3);
    const [rows, setRows] = useState(3);

    const insertText = (before: string, after: string = '') => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = value.substring(start, end);
        const newText = value.substring(0, start) + before + selectedText + after + value.substring(end);

        onChange(newText);

        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + before.length, end + before.length);
        }, 0);
    };

    /** Insert a block (e.g. a table) on its own lines. */
    const insertBlock = (block: string) => {
        const textarea = textareaRef.current;
        const start = textarea ? textarea.selectionStart : value.length;
        const needsLeadingBreak = start > 0 && value[start - 1] !== '\n';
        const chunk = `${needsLeadingBreak ? '\n\n' : ''}${block}\n`;
        onChange(value.slice(0, start) + chunk + value.slice(start));
        setTimeout(() => textareaRef.current?.focus(), 0);
    };

    return (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/50">
                <button type="button" onClick={() => insertText('**', '**')} className={TOOLBAR_BUTTON} title={t('editor.bold')}>
                    <Bold className="size-4" />
                </button>
                <button type="button" onClick={() => insertText('*', '*')} className={TOOLBAR_BUTTON} title={t('editor.italic')}>
                    <Italic className="size-4" />
                </button>
                <button type="button" onClick={() => insertText('`', '`')} className={TOOLBAR_BUTTON} title={t('editor.code')}>
                    <Code className="size-4" />
                </button>
                <button type="button" onClick={() => insertText('[', '](url)')} className={TOOLBAR_BUTTON} title={t('editor.link')}>
                    <LinkIcon className="size-4" />
                </button>
                <button type="button" onClick={() => insertText('- ')} className={TOOLBAR_BUTTON} title={t('editor.list')}>
                    <List className="size-4" />
                </button>

                <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setTableOpen((open) => !open)}
                        className={TOOLBAR_BUTTON}
                        title={t('editor.table')}
                        aria-expanded={tableOpen}
                    >
                        <TableIcon className="size-4" />
                    </button>
                    {tableOpen && (
                        <div className="absolute z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                            <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                                {t('editor.tableSize')}
                            </p>
                            <div className="flex items-center gap-2">
                                <label className="flex-1 text-xs text-slate-500">
                                    {t('editor.columns')}
                                    <input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={columns}
                                        onChange={(event) =>
                                            setColumns(Math.min(10, Math.max(1, Number(event.target.value) || 1)))
                                        }
                                        className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                                    />
                                </label>
                                <label className="flex-1 text-xs text-slate-500">
                                    {t('editor.rows')}
                                    <input
                                        type="number"
                                        min={1}
                                        max={30}
                                        value={rows}
                                        onChange={(event) =>
                                            setRows(Math.min(30, Math.max(1, Number(event.target.value) || 1)))
                                        }
                                        className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                                    />
                                </label>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    insertBlock(tableSkeleton(columns, rows));
                                    setTableOpen(false);
                                }}
                                className="mt-2 w-full rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                            >
                                {t('editor.insertTable')}
                            </button>
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    className={TOOLBAR_BUTTON}
                    title={t('editor.pasteSheet')}
                >
                    <span className="text-[11px] font-semibold">XLS</span>
                </button>
            </div>

            {/* Text Area */}
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || t('editor.placeholder')}
                className="min-h-[120px] w-full resize-y bg-transparent p-3 text-sm outline-none dark:text-slate-100"
            />

            {sheetOpen && (
                <SheetPasteModal
                    onClose={() => setSheetOpen(false)}
                    onInsert={(markdown) => {
                        insertBlock(markdown);
                        setSheetOpen(false);
                    }}
                />
            )}
        </div>
    );
}

/** Paste cells copied from Excel/Sheets (or a CSV file) and turn them into a table. */
function SheetPasteModal({
    onClose,
    onInsert,
}: {
    onClose: () => void;
    onInsert: (markdown: string) => void;
}) {
    const { t } = useTranslation();
    const [raw, setRaw] = useState('');

    const rows = parseDelimited(raw);
    const markdown = toMarkdownTable(rows);
    const preview = rows.slice(0, 4);

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
            <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">{t('editor.pasteSheetTitle')}</h3>
                    <button type="button" onClick={onClose} aria-label={t('common.cancel')}>
                        <X className="size-4" />
                    </button>
                </div>
                <p className="mb-2 text-xs text-slate-500">{t('editor.pasteSheetHint')}</p>
                <textarea
                    value={raw}
                    onChange={(event) => setRaw(event.target.value)}
                    placeholder={t('editor.pasteSheetPlaceholder')}
                    className="min-h-[140px] w-full rounded-lg border border-slate-200 p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-800"
                    autoFocus
                />

                {preview.length > 0 && (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full border-collapse text-xs">
                            <tbody>
                                {preview.map((row, rowIndex) => (
                                    <tr key={rowIndex} className={rowIndex === 0 ? 'bg-slate-50 font-medium dark:bg-slate-800' : ''}>
                                        {row.map((cell, cellIndex) => (
                                            <td key={cellIndex} className="border border-slate-200 px-2 py-1 dark:border-slate-700">
                                                {cell}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {rows.length > preview.length && (
                    <p className="mt-1 text-xs text-slate-400">
                        {t('editor.moreRows', { count: rows.length - preview.length })}
                    </p>
                )}

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        disabled={!markdown}
                        onClick={() => onInsert(markdown)}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                        {t('editor.insertTable')}
                    </button>
                </div>
            </div>
        </div>
    );
}
