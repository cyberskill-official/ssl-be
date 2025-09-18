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
            { path: 'city' },
            { path: 'country' },
            {
                path: 'entity',
                populate: [
                    { path: 'lookingFor' },
                    { path: 'profilePurpose' },
                    ...(filter.entityType === E_LocationEntityType.EVENT
                        ? [
                                { path: 'createdBy' },
                                {
                                    path: 'createdBy',
                                    populate: [
                                        {
                                            path: 'partner1',
                                            populate: [
                                                {
                                                    path: 'gallery',
                                                },
                                            ],
                                        },
                                        {
                                            path: 'partner2',
                                            populate: [
                                                'gallery',
                                            ],
                                        },
                                    ],
                                },
                            ]
                        : []),
                    ...(filter.entityType === E_LocationEntityType.USER
                        ? [
                                {
                                    path: 'partner1',
                                    populate: [
                                        'gallery',
                                        {
                                            path: 'gallery',
                                            populate: [
                                                'uploadedBy',
                                            ],
                                        },
                                    ],
                                },
                                {
                                    path: 'partner1',
                                    populate: [
                                        'gallery',
                                        {
                                            path: 'gallery',
                                            populate: [
                                                'uploadedBy',
                                            ],
                                        },
                                    ],
                                },
                                { path: 'lookingFor' },
                                { path: 'profilePurpose' },
                            ]
                        : []),
                ],
            },
        ];

        const pagingResult = await mongooseCtr.findPaging(baseFilter, {
            ...options,
            populate: populates,
        });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult;
        }

        return pagingResult;
    },
};
