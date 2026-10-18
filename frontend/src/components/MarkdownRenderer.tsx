import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

export function MarkdownRenderer({ content }: { content: string }) {
    if (!content) return <p className="text-sm text-slate-400">No description provided.</p>;

    return (
        <div className="markdown-content text-sm text-slate-700 dark:text-slate-200">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {content}
            </ReactMarkdown>
        </div>
    );
}