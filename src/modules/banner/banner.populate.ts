import type { T_Input_Populate, T_PopulateOptions } from '@cyberskill/shared/node/mongo';

type T_BannerPopulateEntry = string | { path?: string };

const bannerPopulate: T_PopulateOptions[] = [
    { path: 'createdBy' },
    { path: 'blog' },
    { path: 'destination' },
];

function toPopulateOption(entry: T_BannerPopulateEntry): T_PopulateOptions | null {
    if (typeof entry === 'string') {
        return entry.trim().length > 0 ? { path: entry } : null;
    }

    return typeof entry.path === 'string' && entry.path.trim().length > 0
        ? { path: entry.path }
        : null;
}

export function mergeBannerPopulate(populate?: T_Input_Populate): T_PopulateOptions[] {
    const incomingPopulate = (() => {
        if (!populate)
            return [] as T_BannerPopulateEntry[];

        return Array.isArray(populate) ? populate.slice() as T_BannerPopulateEntry[] : [populate] as T_BannerPopulateEntry[];
    })();

    const mergedPopulate = incomingPopulate
        .map(toPopulateOption)
        .filter((entry): entry is T_PopulateOptions => entry !== null);

    const existingPaths = new Set(mergedPopulate.map(entry => entry.path));

    for (const entry of bannerPopulate) {
        if (!existingPaths.has(entry.path)) {
            mergedPopulate.push(entry);
        }
    }

    return mergedPopulate;
}
