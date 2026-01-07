import type { T_QueryFilter } from '@cyberskill/shared/node/mongo';

import type { I_State } from './state.type.js';

/**
 * Sanitize filter object, removing undefined values
 */
export function sanitizeFilter(rawFilter?: Record<string, unknown>) {
    return Object.entries(rawFilter ?? {}).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (value !== undefined) {
            acc[key] = value;
        }
        return acc;
    }, {});
}

/**
 * Merge two filters using $and operator
 */
export function mergeFilters(
    base?: T_QueryFilter<I_State>,
    extra?: T_QueryFilter<I_State>,
): T_QueryFilter<I_State> | undefined {
    const hasBase = !!base && Object.keys(base).length > 0;
    const hasExtra = !!extra && Object.keys(extra).length > 0;

    if (!hasBase && !hasExtra) {
        return undefined;
    }

    if (!hasBase) {
        return extra;
    }

    if (!hasExtra) {
        return base;
    }

    return { $and: [base, extra] } as T_QueryFilter<I_State>;
}

/**
 * Build coordinate filter for latitude and longitude
 * Uses regex for fuzzy matching (starts with pattern)
 */
export function buildCoordinateFilter(
    latitude?: string | null,
    longitude?: string | null,
): T_QueryFilter<I_State> | undefined {
    const trimmedLat = latitude?.trim();
    const trimmedLng = longitude?.trim();

    if (!trimmedLat && !trimmedLng) {
        return undefined;
    }

    const filters: T_QueryFilter<I_State>[] = [];

    if (trimmedLat) {
        filters.push({ latitude: { $regex: `^${trimmedLat}`, $options: 'i' } } as T_QueryFilter<I_State>);
    }

    if (trimmedLng) {
        filters.push({ longitude: { $regex: `^${trimmedLng}`, $options: 'i' } } as T_QueryFilter<I_State>);
    }

    if (filters.length === 1) {
        return filters[0];
    }

    return { $and: filters } as T_QueryFilter<I_State>;
}
