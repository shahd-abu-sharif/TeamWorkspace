import { useRef } from 'react';
import { Bold, Italic, Code, Link as LinkIcon, List } from 'lucide-react';

export function MarkdownEditor({
    value,
    onChange,
    placeholder
}: {
    value: string;
    onChange: (val: string) => void;
    placeholder?: string
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    return (
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900/50">
                <button type="button" onClick={() => insertText('**', '**')} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded dark:hover:bg-slate-700" title="Bold"><Bold className="size-4" /></button>
                <button type="button" onClick={() => insertText('*', '*')} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded dark:hover:bg-slate-700" title="Italic"><Italic className="size-4" /></button>
                <button type="button" onClick={() => insertText('`', '`')} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded dark:hover:bg-slate-700" title="Code"><Code className="size-4" /></button>
                <button type="button" onClick={() => insertText('[', '](url)')} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded dark:hover:bg-slate-700" title="Link"><LinkIcon className="size-4" /></button>
                <button type="button" onClick={() => insertText('- ')} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded dark:hover:bg-slate-700" title="List"><List className="size-4" /></button>
            </div>
            {/* Text Area */}
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || "Write a description... (Markdown supported)"}
                className="min-h-[120px] w-full resize-y bg-transparent p-3 text-sm outline-none dark:text-slate-100"
            />
        </div>
    );
}