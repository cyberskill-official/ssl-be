import type { T_QueryFilter } from '@cyberskill/shared/node/mongo';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { countryCtr, E_LocationEntityType, locationCtr } from '#modules/location/index.js';

import type { I_Destination } from './destination.type.js';

export function sortDestinationsByRating<T extends { rating?: string }>(destinations: T[]): T[] {
    const ratingOrder: Record<string, number> = { GOLD: 0, SILVER: 1, BRONZE: 2 };
    return destinations.toSorted((a, b) => {
        const aRating = typeof a.rating === 'string' ? a.rating.toUpperCase() : '';
        const bRating = typeof b.rating === 'string' ? b.rating.toUpperCase() : '';
        const aOrder = ratingOrder[aRating] ?? 99;
        const bOrder = ratingOrder[bRating] ?? 99;
        return aOrder - bOrder;
    });
}

export function buildDestinationSort(sort?: Record<string, 1 | -1>): Record<string, 1 | -1> {
    if (!sort || typeof sort !== 'object' || Array.isArray(sort)) {
        return { ratingOrder: 1, createdAt: -1 };
    }

    const { ratingOrder: _ignored, ...rest } = sort as Record<string, 1 | -1>;
    return { ratingOrder: 1, ...rest };
}

export function sanitizeFilter(rawFilter?: Record<string, unknown>) {
    return Object.entries(rawFilter ?? {}).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (value !== undefined) {
            acc[key] = value;
        }
        return acc;
    }, {});
}

/**
 * Supported locales used for multilingual field lookups.
 * Must match the locales in localize.ts and translation queue.
 */
const MULTILINGUAL_LOCALES = ['en', 'da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi'];

/**
 * Fields that are stored as I_LocalizedString (multilingual objects).
 * When a filter passes a plain string for these fields, we need to search
 * across all language variants using dot notation.
 */
const MULTILINGUAL_FIELDS = new Set(['slug', 'name']);

/**
 * Normalize filters for multilingual fields.
 * When a string value is passed for a multilingual field (e.g. slug: "paris-club"),
 * MongoDB cannot match it against the stored object { en: "paris-club", fr: "..." }.
 * This transforms the filter to search across all locale keys using $or.
 */
export function normalizeMultilingualFilter(filter: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    const orConditions: Record<string, unknown>[] = [];

    for (const [key, value] of Object.entries(filter)) {
        if (MULTILINGUAL_FIELDS.has(key) && typeof value === 'string') {
            // Match both multilingual objects AND plain strings (pre-translation fallback)
            orConditions.push({ [key]: value });
            orConditions.push(
                ...MULTILINGUAL_LOCALES.map(locale => ({
                    [`${key}.${locale}`]: value,
                })),
            );
        }
        else {
            normalized[key] = value;
        }
    }

    if (orConditions.length > 0) {
        // Merge existing $or with our new conditions
        const existingOr = Array.isArray(filter['$or']) ? filter['$or'] as Record<string, unknown>[] : [];
        normalized['$or'] = [...existingOr, ...orConditions];
    }

    return normalized;
}

export function mergeFilters(
    base?: T_QueryFilter<I_Destination>,
    extra?: T_QueryFilter<I_Destination>,
): T_QueryFilter<I_Destination> | undefined {
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

    return { $and: [base, extra] } as T_QueryFilter<I_Destination>;
}

export async function buildCountryNameFilter(
    context: I_Context,
    countryName?: string | null,
): Promise<T_QueryFilter<I_Destination> | undefined> {
    const trimmedName = countryName?.trim();

    if (!trimmedName) {
        return undefined;
    }

    const countriesResult = await countryCtr.getCountries(context, {
        filter: { name: trimmedName },
        options: { pagination: false },
    });

    if (!countriesResult.success) {
        throwError({
            message: countriesResult.message || 'Failed to fetch countries for destination filter',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    const countryDocs = countriesResult.result.docs ?? [];
    const countryIds = countryDocs
        .map(country => country.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

    if (!countryIds.length) {
        return { id: { $in: [] } } as T_QueryFilter<I_Destination>;
    }

    const destinationIdsResult = await locationCtr.distinct('entityId', {
        isDel: false,
        entityType: E_LocationEntityType.DESTINATION,
        countryId: { $in: countryIds },
    });

    if (!destinationIdsResult.success) {
        throwError({
            message: destinationIdsResult.message || 'Failed to fetch destination ids by country',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    const destinationIds = (destinationIdsResult.result as Array<string | null | undefined> | undefined) ?? [];
    const uniqueDestinationIds = [...new Set(
        destinationIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    )];

    return {
        id: {
            $in: uniqueDestinationIds,
        },
    } as T_QueryFilter<I_Destination>;
}

export async function buildCountryIdFilter(
    countryId?: string | null,
): Promise<T_QueryFilter<I_Destination> | undefined> {
    const trimmedId = countryId?.trim();

    if (!trimmedId) {
        return undefined;
    }

    const destinationIdsResult = await locationCtr.distinct('entityId', {
        isDel: false,
        entityType: E_LocationEntityType.DESTINATION,
        countryId: trimmedId,
    });

    if (!destinationIdsResult.success) {
        throwError({
            message: destinationIdsResult.message || 'Failed to fetch destination ids by country',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    const destinationIds = [...new Set(
        ((destinationIdsResult.result as Array<string | null | undefined> | undefined) ?? [])
            .map(id => (typeof id === 'string' ? id.trim() : ''))
            .filter((id): id is string => id.length > 0),
    )];

    return {
        id: {
            $in: destinationIds,
        },
    } as T_QueryFilter<I_Destination>;
}
