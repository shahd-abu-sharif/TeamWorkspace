export type EpicRef = {
    reference: number;
    title?: string | null;
    team?: { id?: string | null; name?: string | null } | null;
};

/**
 * Short handle for a team name used in epic identifiers:
 * "UI/UX" -> "UIUX", "Backend" -> "BACKEND", "Backend Team" -> "BT".
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
    return tokens
        .map((token) => token[0])
        .join('')
        .slice(0, 6);
}

/** "UIUX-EPIC4"; epics without a team stay "EPIC-4". */
export function epicCode(epic: EpicRef): string {
    const code = teamCode(epic.team?.name);
    return code ? `${code}-EPIC${epic.reference}` : `EPIC-${epic.reference}`;
}

/** "UIUX-EPIC4 · Payment revamp" */
export function epicLabel(epic: EpicRef): string {
    const code = epicCode(epic);
    return epic.title ? `${code} · ${epic.title}` : code;
}
