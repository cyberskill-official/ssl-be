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

        if (filter.entityType === E_LocationEntityType.USER && context.req?.session?.user) {
            const currentUser = await authnCtr.getUserFromSession(context);
            const tempLocationId = currentUser.settings?.temporaryLocation?.locationId;
            const partner1LocationId = currentUser.partner1?.locationId;

            if (tempLocationId) {
                const tempLocation = await locationCtr.getLocation(context, { filter: { id: tempLocationId } });

                if (tempLocation.success && tempLocation.result?.map) {
                    const { map } = tempLocation.result;
                    const inViewport = map.longitude >= filter.southWestLongitude
                        && map.longitude <= filter.northEastLongitude
                        && map.latitude >= filter.southWestLatitude
                        && map.latitude <= filter.northEastLatitude;

                    if (inViewport) {
                        return {
                            success: true,
                            result: {
                                docs: [tempLocation.result],
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
                        };
                    }
                }
            }

            const excludeLocationIds = [];
            if (tempLocationId) {
                excludeLocationIds.push(tempLocationId);
            }
            if (partner1LocationId && partner1LocationId !== tempLocationId) {
                // Kiểm tra xem partner1 location có trùng với temporary location không
                if (tempLocationId) {
                    const tempLocation = await locationCtr.getLocation(context, { filter: { id: tempLocationId } });
                    const partner1Location = await locationCtr.getLocation(context, { filter: { id: partner1LocationId } });

                    if (tempLocation.success && partner1Location.success
                        && tempLocation.result?.map && partner1Location.result?.map) {
                        const tempMap = tempLocation.result.map;
                        const partner1Map = partner1Location.result.map;

                        // Nếu 2 location có cùng tọa độ thì không thêm partner1 vào exclude list
                        const isSameLocation = tempMap.latitude === partner1Map.latitude
                            && tempMap.longitude === partner1Map.longitude;

                        if (!isSameLocation) {
                            excludeLocationIds.push(partner1LocationId);
                        }
                    }
                    else {
                        excludeLocationIds.push(partner1LocationId);
                    }
                }
                else {
                    excludeLocationIds.push(partner1LocationId);
                }
            }

            return mongooseCtr.findPaging({
                ...baseFilter,
                $and: [
                    baseFilter,
                    {
                        $or: [
                            { entityType: { $ne: E_LocationEntityType.USER } },
                            { entityType: E_LocationEntityType.USER, id: { $nin: excludeLocationIds } },
                        ],
                    },
                ],
            }, options);
        }

        return mongooseCtr.findPaging(baseFilter, options);
    },
};
