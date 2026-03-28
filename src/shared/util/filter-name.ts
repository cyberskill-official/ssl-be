export interface T_RegexFilter { $regex: string; $options?: 'i' | 'm' | 's' | 'u' | 'y' | 'g' }

const REGEX_SPECIAL_CHARS_RE = /[.*+?^${}()|[\]\\]/g;
export const escapeRegex = (input: string): string => input.replace(REGEX_SPECIAL_CHARS_RE, '\\$&');

export function buildStartsWithFilter(raw: unknown): T_RegexFilter | undefined {
    if (typeof raw !== 'string')
        return undefined;
    const trimmed = raw.trim();
    if (trimmed === '')
        return undefined;
    return { $regex: `^${escapeRegex(trimmed)}`, $options: 'i' };
}

export function buildContainsFilter(raw: unknown): T_RegexFilter | undefined {
    if (typeof raw !== 'string')
        return undefined;
    const trimmed = raw.trim();
    if (trimmed === '')
        return undefined;
    return { $regex: escapeRegex(trimmed), $options: 'i' };
}

export function applyNameFilters(base: Record<string, unknown>, fields: Array<{ key: string; value: unknown; mode?: 'startsWith' | 'contains' }>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...base };
    for (const { key, value, mode = 'startsWith' } of fields) {
        const built = mode === 'contains' ? buildContainsFilter(value) : buildStartsWithFilter(value);
        if (built)
            next[key] = built;
    }
    return next;
}
