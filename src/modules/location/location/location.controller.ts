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

import type { I_Input_CreateLocation, I_Input_GetLocationInViewport, I_Input_QueryLocation, I_Input_UpdateLocation, I_Location } from './location.type.js';

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

        const baseFilter = {
            map: {
                longitude: { $gte: filter.southWestLongitude, $lte: filter.northEastLongitude },
                latitude: { $gte: filter.southWestLatitude, $lte: filter.northEastLatitude },
            },
        };

        // Chỉ xử lý logic ưu tiên cho USER entity type
        if (filter.entityType !== E_LocationEntityType.USER || !authChecked.success) {
            return mongooseCtr.findPaging(baseFilter, options);
        }

        const currentUser = authChecked.result.user;
        const tempLocationId = currentUser?.settings?.temporaryLocation?.locationId;
        const tempLocationEndAt = currentUser?.settings?.temporaryLocation?.endAt;
        const partner1LocationId = currentUser?.partner1?.locationId;

        // Helper function để kiểm tra location có trong viewport không
        const isLocationInViewport = (location: I_Location) => {
            if (!location.map)
                return false;
            const { map } = location;
            return map.longitude >= filter.southWestLongitude
                && map.longitude <= filter.northEastLongitude
                && map.latitude >= filter.southWestLatitude
                && map.latitude <= filter.northEastLatitude;
        };

        // Helper function để tạo single location response
        const createSingleResponse = (location: I_Location): I_Return<T_PaginateResult<I_Location>> => ({
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

        // Ưu tiên temporary location nếu có endAt
        if (tempLocationId && tempLocationEndAt) {
            const tempLocation = await locationCtr.getLocation(context, { filter: { id: tempLocationId } });
            if (tempLocation.success && tempLocation.result && isLocationInViewport(tempLocation.result)) {
                return createSingleResponse(tempLocation.result);
            }
        }

        // Ưu tiên partner location nếu không có temporary location với endAt
        if (partner1LocationId && (!tempLocationId || !tempLocationEndAt)) {
            const partner1Location = await locationCtr.getLocation(context, { filter: { id: partner1LocationId } });
            if (partner1Location.success && partner1Location.result && isLocationInViewport(partner1Location.result)) {
                return createSingleResponse(partner1Location.result);
            }
        }

        // Tìm các location khác, exclude location đã ưu tiên
        const excludeIds = [];
        if (tempLocationId && tempLocationEndAt)
            excludeIds.push(tempLocationId);
        if (partner1LocationId && (!tempLocationId || !tempLocationEndAt))
            excludeIds.push(partner1LocationId);

        return mongooseCtr.findPaging({
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
        }, options);
    },
};
