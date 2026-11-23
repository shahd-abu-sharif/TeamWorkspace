export type EpicRef = {
    reference: number;
    title?: string | null;
    /** Flat `{ name }` (epic endpoints) or nested `{ team: { name } }` (task payloads). */
    teams?: { name?: string | null; team?: { name?: string | null } | null }[] | null;
    /** Legacy single-team shape. */
    team?: { id?: string | null; name?: string | null } | null;
};

/**
 * Short handle for a team name used in epic identifiers:
 * "UI/UX Design" -> "UIUX", "Frontend Development" -> "FD",
 * "Design" -> "DESIGN", "Backend Team" -> "BT".
 */
export function teamCode(name?: string | null): string | null {
    const tokens = (name ?? '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(Boolean);
    if (!tokens.length) return null;
    if (tokens.length === 1) return tokens[0].slice(0, 6);

    const joined = tokens.join('');
    if (joined.length <= 6) return joined;

    // Keep the leading words that still fit ("UI/UX Design" -> UIUX); if none
    // fit, fall back to initials ("Frontend Development" -> FD).
    const kept: string[] = [];
    let length = 0;
    for (const token of tokens) {
        if (length + token.length > 6) break;
        kept.push(token);
        length += token.length;
    }
    if (kept.length > 1) return kept.join('').slice(0, 6);
    return tokens
        .map((token) => token[0])
        .join('')
        .slice(0, 6);
}

/** "UIUX-EPIC4", "UIUX+BE-EPIC4"; epics without a team stay "EPIC-4". */
export function epicCode(epic: EpicRef): string {
    const names = (epic.teams ?? [])
        .map((team) => team?.name ?? team?.team?.name)
        .filter(Boolean) as string[];
    if (!names.length && epic.team?.name) names.push(epic.team.name);
    const codes = [...new Set(names.map((name) => teamCode(name)).filter(Boolean))] as string[];
    return codes.length ? `${codes.join('+')}-EPIC${epic.reference}` : `EPIC-${epic.reference}`;
}

/** "UIUX-EPIC4 · Payment revamp" */
export function epicLabel(epic: EpicRef): string {
    const code = epicCode(epic);
    return epic.title ? `${code} · ${epic.title}` : code;
}
