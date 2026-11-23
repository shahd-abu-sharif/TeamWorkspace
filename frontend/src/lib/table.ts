// apps/web/src/lib/table.ts
//
// Helpers for writing Markdown tables without hand-typing pipes: either build an
// empty skeleton, or paste cells copied straight out of Excel / Google Sheets
// (tab separated) or a CSV file.

/** Split a line into cells, honouring simple "quoted, cells" CSV rules. */
function splitLine(line: string, delimiter: string): string[] {
    if (delimiter !== ',') return line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ''));

    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === delimiter && !quoted) {
            cells.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current.trim());
    return cells;
}

/** Parse pasted spreadsheet text (TSV preferred, falls back to CSV). */
export function parseDelimited(text: string): string[][] {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) return [];

    const delimiter = lines.some((line) => line.includes('\t')) ? '\t' : ',';
    const rows = lines.map((line) => splitLine(line, delimiter));

    // Drop trailing empty columns so a stray tab doesn't widen the table.
    const width = Math.max(...rows.map((row) => row.length));
    return rows.map((row) => {
        const filled = [...row, ...Array(Math.max(0, width - row.length)).fill('')];
        return filled;
    });
}

const escapeCell = (cell: string) => cell.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');

/** Build a Markdown table: first row becomes the header, the rest become body rows. */
export function toMarkdownTable(rows: string[][]): string {
    const cleaned = rows
        .map((row) => row.map((cell) => escapeCell(cell.trim())))
        .filter((row) => row.some((cell) => cell.length > 0));
    if (cleaned.length === 0) return '';

    const width = Math.max(...cleaned.map((row) => row.length));
    const pad = (row: string[]) => [...row, ...Array(Math.max(0, width - row.length)).fill('')];
    const [header, ...body] = cleaned;
    const lines = [
        `| ${pad(header).join(' | ')} |`,
        `| ${Array(width).fill('---').join(' | ')} |`,
        ...body.map((row) => `| ${pad(row).join(' | ')} |`),
    ];
    return lines.join('\n');
}

/** Empty table with a header row and `rows` body rows (cells left blank). */
export function tableSkeleton(columns: number, rows: number): string {
    const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
    const header = row(Array.from({ length: columns }, (_, index) => `Column ${index + 1}`));
    const divider = row(Array.from({ length: columns }, () => '---'));
    const empty = row(Array.from({ length: columns }, () => ' '));
    return [header, divider, ...Array.from({ length: rows }, () => empty)].join('\n');
}
