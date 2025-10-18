import type { T_FilterQuery } from '@cyberskill/shared/node/mongo';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { countryCtr, E_LocationEntityType, locationCtr } from '#modules/location/index.js';

import type { I_Destination } from './destination.type.js';

export function sanitizeFilter(rawFilter?: Record<string, unknown>) {
    return Object.entries(rawFilter ?? {}).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (value !== undefined) {
            acc[key] = value;
        }
        return acc;
    }, {});
}

export function mergeFilters(
    base?: T_FilterQuery<I_Destination>,
    extra?: T_FilterQuery<I_Destination>,
): T_FilterQuery<I_Destination> | undefined {
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

    return { $and: [base, extra] } as T_FilterQuery<I_Destination>;
}

export async function buildCountryNameFilter(
    context: I_Context,
    countryName?: string | null,
): Promise<T_FilterQuery<I_Destination> | undefined> {
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
        return { id: { $in: [] } } as T_FilterQuery<I_Destination>;
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
    const uniqueDestinationIds = Array.from(
        new Set(
            destinationIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
        ),
    );

    return {
        id: {
            $in: uniqueDestinationIds,
        },
    } as T_FilterQuery<I_Destination>;
}

export async function buildCountryIdFilter(
    countryId?: string | null,
): Promise<T_FilterQuery<I_Destination> | undefined> {
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

    const destinationIds = Array.from(
        new Set(
            ((destinationIdsResult.result as Array<string | null | undefined> | undefined) ?? [])
                .map(id => (typeof id === 'string' ? id.trim() : ''))
                .filter((id): id is string => id.length > 0),
        ),
    );

    return {
        id: {
            $in: destinationIds,
        },
    } as T_FilterQuery<I_Destination>;
}
