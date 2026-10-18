import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

export function MarkdownRenderer({ content }: { content: string }) {
    if (!content) return <p className="text-sm text-slate-400">No description provided.</p>;

    return (
        <div className="prose prose-sm max-w-none prose-slate dark:prose-invert prose-p:leading-relaxed prose-pre:bg-slate-800 prose-pre:text-slate-100">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {content}
            </ReactMarkdown>
        </div>
    );
}