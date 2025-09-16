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

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/authn.controller.js';

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
            throwError({
                message: 'Location not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteLocation: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryLocation>,
    ): Promise<I_Return<I_Location>> => {
        const locationFound = await locationCtr.getLocation(context, { filter });

        if (!locationFound.success) {
            throwError({
                message: 'Location not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    getLocationsInViewport: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_GetLocationInViewport>,
    ): Promise<I_Return<T_PaginateResult<I_Location>>> => {
        const authChecked = await authnCtr.checkAuth(context);

        if (!authChecked.success) {
            throwError({
                message: 'Unauthorized',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        if (!filter) {
            throwError({
                message: 'Filter is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Build base filter with viewport
        const baseFilter: any = {
            map: {
                longitude: { $gte: filter.southWestLongitude, $lte: filter.northEastLongitude },
                latitude: { $gte: filter.southWestLatitude, $lte: filter.northEastLatitude },
            },
        };

        // If filter.entityType is provided, add it to the base filter
        if (filter.entityType) {
            baseFilter.entityType = filter.entityType;
        }

        if (filter.entityType !== E_LocationEntityType.USER || !authChecked.success) {
            return mongooseCtr.findPaging(baseFilter, options);
        }

        const currentUser = authChecked.result.user;
        const tempLocationId = currentUser?.settings?.temporaryLocation?.locationId;
        const tempLocationEndAt = currentUser?.settings?.temporaryLocation?.endAt;
        const partner1LocationId = currentUser?.partner1?.locationId;
        const currentUserId = currentUser?.id;

        const isLocationInViewport = (location: I_Location) => {
            if (!location.map)
                return false;
            const { map } = location;
            return (
                map.longitude >= filter.southWestLongitude
                && map.longitude <= filter.northEastLongitude
                && map.latitude >= filter.southWestLatitude
                && map.latitude <= filter.northEastLatitude
            );
        };

        // Utility: create a single-item paginated response
        const createSingleResponse = (
            location: I_Location,
        ): I_Return<T_PaginateResult<I_Location>> => ({
            success: true as const,
            result: {
                docs: [location],
                totalDocs: 1,
                limit: options?.limit || 10,
                hasPrevPage: false,
                hasNextPage: false,
                page: 1,
                totalPages: 1,
                offset: 0,
                prevPage: 0,
                nextPage: 0,
                pagingCounter: 1,
                meta: undefined,
            },
        });

        // Check if temporary location is still valid
        const isTemporaryLocationValid
            = tempLocationId && tempLocationEndAt && new Date(tempLocationEndAt) > new Date();

        const excludeIds: string[] = [];

        // Priority 1: valid temporary location
        if (isTemporaryLocationValid) {
            const tempLocation = await locationCtr.getLocation(context, { filter: { id: tempLocationId } });
            if (tempLocation.success && tempLocation.result && isLocationInViewport(tempLocation.result)) {
                return createSingleResponse(tempLocation.result);
            }
            excludeIds.push(tempLocationId);
        }

        // Priority 2: partner1 location if no valid temporary location
        if (partner1LocationId && !isTemporaryLocationValid) {
            const partner1Location = await locationCtr.getLocation(context, { filter: { id: partner1LocationId } });
            if (partner1Location.success && partner1Location.result && isLocationInViewport(partner1Location.result)) {
                return createSingleResponse(partner1Location.result);
            }
            excludeIds.push(partner1LocationId);
        }

        // Build final filter for paging
        let finalFilter: any = {
            ...baseFilter,
            $and: [
                baseFilter,
                {
                    $or: [
                        { entityType: { $ne: E_LocationEntityType.USER } },
                        { entityType: E_LocationEntityType.USER, id: { $nin: excludeIds } },
                    ],
                },
            ],
        };

        // If temporary location is active, exclude user's original location
        if (isTemporaryLocationValid && currentUserId) {
            finalFilter = {
                ...baseFilter,
                $and: [
                    baseFilter,
                    {
                        $or: [
                            { entityType: { $ne: E_LocationEntityType.USER } },
                            { entityType: E_LocationEntityType.USER, entityId: { $ne: currentUserId } },
                            {
                                entityType: E_LocationEntityType.USER,
                                entityId: currentUserId,
                                id: tempLocationId,
                            },
                        ],
                    },
                ],
            };
        }

        const pagingResult = await mongooseCtr.findPaging(finalFilter, options);

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult as any;
        }

        // Deduplicate by entity id
        const docs = pagingResult.result.docs || [];
        const seen = new Set<string>();
        const deduped: I_Location[] = [];

        for (const d of docs) {
            const entityIdFromEntity = (d as any)?.entity?.id || (d as any)?.entity?._id;
            const key
                = entityIdFromEntity
                    || d.entityId
                    || d.id
                    || (d.map ? `${d.map.latitude}-${d.map.longitude}` : '');
            const sk = key ? String(key) : '';
            if (sk) {
                if (seen.has(sk))
                    continue;
                seen.add(sk);
            }
            deduped.push(d);
        }

        // Recalculate pagination meta
        const limit = pagingResult.result.limit || options?.limit || 10;
        const page = pagingResult.result.page || 1;
        const totalDocs = deduped.length;
        const totalPages = Math.max(1, Math.ceil(totalDocs / limit));
        const hasPrevPage = page > 1;
        const hasNextPage = page < totalPages;
        const offset = pagingResult.result.offset ?? (page - 1) * limit;

        const newResult: T_PaginateResult<I_Location> = {
            ...pagingResult.result,
            docs: deduped,
            totalDocs,
            totalPages,
            hasPrevPage,
            hasNextPage,
            offset,
            prevPage: hasPrevPage ? page - 1 : 0,
            nextPage: hasNextPage ? page + 1 : 0,
            pagingCounter: offset + 1,
        };

        return {
            success: true as const,
            result: newResult,
        };
    },
};
