import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult, T_QueryFilter } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_QueryState, I_State } from './state.type.js';

import { buildCoordinateFilter, mergeFilters, sanitizeFilter } from './state.helper.js';
import { StateModel } from './state.model.js';

const mongooseCtr = new MongooseController<I_State>(StateModel);

export const stateCtr = {
    getState: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryState>,
    ): Promise<I_Return<I_State>> => {
        const workingFilter = filter ? { ...filter } : {};
        const rawLatitude = typeof (workingFilter as { latitude?: unknown }).latitude === 'string'
            ? (workingFilter as { latitude?: string }).latitude
            : undefined;
        const rawLongitude = typeof (workingFilter as { longitude?: unknown }).longitude === 'string'
            ? (workingFilter as { longitude?: string }).longitude
            : undefined;

        delete (workingFilter as { latitude?: string }).latitude;
        delete (workingFilter as { longitude?: string }).longitude;

        const sanitizedFilterObject = sanitizeFilter(workingFilter as Record<string, unknown> | undefined);
        const baseFilter = Object.keys(sanitizedFilterObject).length > 0
            ? sanitizedFilterObject as T_QueryFilter<I_State>
            : undefined;

        const coordinateFilter = buildCoordinateFilter(rawLatitude, rawLongitude);
        const effectiveFilter = mergeFilters(baseFilter, coordinateFilter) ?? baseFilter;

        return mongooseCtr.findOne(effectiveFilter ?? undefined, projection, options, populate);
    },
    getStates: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryState>,
    ): Promise<I_Return<T_PaginateResult<I_State>>> => {
        const workingFilter = filter ? { ...filter } : {};
        const rawLatitude = typeof (workingFilter as { latitude?: unknown }).latitude === 'string'
            ? (workingFilter as { latitude?: string }).latitude
            : undefined;
        const rawLongitude = typeof (workingFilter as { longitude?: unknown }).longitude === 'string'
            ? (workingFilter as { longitude?: string }).longitude
            : undefined;

        delete (workingFilter as { latitude?: string }).latitude;
        delete (workingFilter as { longitude?: string }).longitude;

        const sanitizedFilterObject = sanitizeFilter(workingFilter as Record<string, unknown> | undefined);
        const baseFilter = Object.keys(sanitizedFilterObject).length > 0
            ? sanitizedFilterObject as T_QueryFilter<I_State>
            : undefined;

        const coordinateFilter = buildCoordinateFilter(rawLatitude, rawLongitude);
        const effectiveFilter = mergeFilters(baseFilter, coordinateFilter) ?? baseFilter;

        return mongooseCtr.findPaging(effectiveFilter ?? undefined, options);
    },
};
