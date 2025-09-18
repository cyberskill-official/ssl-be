import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_FilterQuery,
    T_PaginateResult,
    T_QueryOptions,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';
import type { PopulateOptions } from 'mongoose';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Event } from '#modules/event/event.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_CreateLocation,
    I_Input_GetLocationInViewport,
    I_Input_QueryLocation,
    I_Input_UpdateLocation,
    I_Location,
} from './location.type.js';

import { LocationModel } from './location.model.js';
import { E_LocationEntityType } from './location.type.js';

const mongooseCtr = new MongooseController<I_Location>(LocationModel);

export const locationCtr = {
    distinct: async (
        key: string,
        filter?: T_FilterQuery<I_Location>,
        options?: T_QueryOptions<I_Location>,
    ): Promise<I_Return<unknown[]>> => {
        return mongooseCtr.distinct(key, filter, options);
    },
    getLocation: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryLocation>,
    ): Promise<I_Return<I_Location>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getLocations: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryLocation>,
    ): Promise<I_Return<T_PaginateResult<I_Location>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createLocation: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateLocation>,
    ): Promise<I_Return<I_Location>> => {
        return mongooseCtr.createOne(doc);
    },
    updateLocation: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateLocation>,
    ): Promise<I_Return<I_Location>> => {
        const locationFound = await locationCtr.getLocation(context, { filter });
        if (!locationFound.success) {
            throwError({ message: 'Location not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteLocation: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryLocation>,
    ): Promise<I_Return<I_Location>> => {
        const locationFound = await locationCtr.getLocation(context, { filter });
        if (!locationFound.success) {
            throwError({ message: 'Location not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.deleteOne(filter, options);
    },
    getLocationsInViewport: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetLocationInViewport>,
    ): Promise<I_Return<T_PaginateResult<I_Location>>> => {
        if (!filter) {
            throwError({ message: 'Filter is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // ---- viewport filter
        const baseFilter: Record<string, unknown> = {
            map: {
                longitude: { $gte: filter.southWestLongitude, $lte: filter.northEastLongitude },
                latitude: { $gte: filter.southWestLatitude, $lte: filter.northEastLatitude },
            },
        };

        if (filter.entityType) {
            baseFilter['entityType'] = filter.entityType;
        }

        const populates: PopulateOptions[] = [
            {
                path: 'entity',
                populate: [
                    { path: 'lookingFor' },
                    { path: 'profilePurpose' },
                    ...(filter.entityType === E_LocationEntityType.EVENT
                        ? [
                                { path: 'createdBy' },
                                {
                                    path: 'location',
                                    model: 'Location',
                                    populate: [{ path: 'country' }, { path: 'city' }],
                                },
                            ]
                        : []),
                    ...(filter.entityType === E_LocationEntityType.USER
                        ? [
                                {
                                    path: 'partner1.location',
                                    model: 'Location',
                                    populate: [{ path: 'country' }, { path: 'city' }],
                                },
                                {
                                    path: 'partner2.location',
                                    model: 'Location',
                                    populate: [{ path: 'country' }, { path: 'city' }],
                                },
                                { path: 'partner1.gallery' },
                                { path: 'partner2.gallery' },
                            ]
                        : []),
                ],
            },
            { path: 'country' },
            { path: 'city' },
        ];

        // ---- query
        const pagingResult = await mongooseCtr.findPaging(baseFilter, {
            ...options,
            populate: populates,
        });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult;
        }

        let docs: I_Location[] = pagingResult.result.docs ?? [];

        if (filter.entityType === E_LocationEntityType.EVENT && filter.eventType) {
            docs = docs.filter((d) => {
                const e = d.entity as I_Event | undefined;
                return e?.type === filter.eventType;
            });
        }

        // ---- dedupe entityId
        const seen = new Set<string>();
        const deduped: I_Location[] = [];

        interface WithId { id?: string }
        const hasId = (v: unknown): v is WithId =>
            typeof v === 'object' && v !== null && 'id' in (v as Record<string, unknown>);

        for (const d of docs) {
            const entityId = hasId(d.entity) ? (d.entity as WithId).id : undefined;
            const fallbackKey = d.map ? `${d.map.latitude}-${d.map.longitude}` : undefined;
            const key = entityId ?? d.entityId ?? d.id ?? fallbackKey;

            if (!key)
                continue;
            if (seen.has(key))
                continue;

            seen.add(key);
            deduped.push(d);
        }

        // ---- rebuild pagination
        const limit = pagingResult.result.limit || options?.limit || 10;
        const page = pagingResult.result.page || 1;
        const totalDocs = deduped.length;
        const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
        const offset = pagingResult.result.offset ?? (page - 1) * limit;

        const newResult: T_PaginateResult<I_Location> = {
            ...pagingResult.result,
            docs: deduped,
            totalDocs,
            totalPages,
            hasPrevPage: page > 1,
            hasNextPage: page < totalPages,
            offset,
            prevPage: page > 1 ? page - 1 : 0,
            nextPage: page < totalPages ? page + 1 : 0,
            pagingCounter: offset + 1,
        };

        return { success: true, result: newResult };
    },

};
