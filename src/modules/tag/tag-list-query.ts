type T_QueryRecord = Record<string, unknown>;

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function prepareTagListQuery(
    filter: T_QueryRecord,
    options: T_QueryRecord | undefined,
): { filter: T_QueryRecord; options: T_QueryRecord } {
    const { search, usageCountLte, ...paginateOptions } = options ?? {};
    const normalizedSearch = typeof search === 'string' ? search.trim() : '';
    const normalizedUsageCount = typeof usageCountLte === 'number' && Number.isFinite(usageCountLte) && usageCountLte >= 0
        ? usageCountLte
        : undefined;

    return {
        filter: {
            ...filter,
            ...(normalizedSearch
                ? { name: new RegExp(escapeRegex(normalizedSearch), 'i') }
                : {}),
            ...(normalizedUsageCount !== undefined
                ? { usageCount: { $lte: normalizedUsageCount } }
                : {}),
        },
        options: paginateOptions,
    };
}
