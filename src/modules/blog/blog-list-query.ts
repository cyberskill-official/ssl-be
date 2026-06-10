type T_QueryRecord = Record<string, unknown>;

export const BLOG_MULTILINGUAL_LOCALES = ['en', 'da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi'];

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function appendAndCondition(filter: T_QueryRecord, condition: T_QueryRecord): T_QueryRecord {
    const existingAnd = Array.isArray(filter['$and']) ? filter['$and'] as T_QueryRecord[] : [];
    const { $and: _ignored, ...baseFilter } = filter;

    return {
        ...baseFilter,
        $and: [...existingAnd, condition],
    };
}

export function prepareBlogListQuery(
    filter: T_QueryRecord,
    options: T_QueryRecord | undefined,
): { filter: T_QueryRecord; options: T_QueryRecord } {
    const { search, ...paginateOptions } = options ?? {};
    const normalizedSearch = typeof search === 'string' ? search.trim() : '';

    if (!normalizedSearch) {
        return { filter, options: paginateOptions };
    }

    const searchRegex = new RegExp(escapeRegex(normalizedSearch), 'i');
    const titleConditions = BLOG_MULTILINGUAL_LOCALES.map(locale => ({
        [`title.${locale}`]: searchRegex,
    }));

    return {
        filter: appendAndCondition(filter, {
            $or: [
                { title: searchRegex },
                ...titleConditions,
                { authorName: searchRegex },
                { hostName: searchRegex },
            ],
        }),
        options: paginateOptions,
    };
}
