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
        if (!filter) {
            throwError({
                message: 'Filter is required',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const baseFilter: any = {
            map: {
                longitude: { $gte: filter.southWestLongitude, $lte: filter.northEastLongitude },
                latitude: { $gte: filter.southWestLatitude, $lte: filter.northEastLatitude },
            },
        };

        if (filter.entityType) {
            baseFilter.entityType = filter.entityType;
        }

        if (filter.entityType === E_LocationEntityType.EVENT && filter.eventType) {
            baseFilter.eventType = filter.eventType;
        }

        // Lấy toàn bộ location trong viewport trước
        const pagingResult = await mongooseCtr.findPaging(baseFilter, {
            ...options,
            populate: [{ path: 'entity' }], // nên populate entity để FE có đủ data
        });

        if (!pagingResult.success || !pagingResult.result) {
            return pagingResult as any;
        }

        let docs = pagingResult.result.docs || [];

        // Nếu entityType = USER → áp dụng flow temp/partner để thay thế trong list
        if (filter.entityType === E_LocationEntityType.USER) {
            const currentUser = context.req?.session?.user;
            const tempLocationId = currentUser?.settings?.temporaryLocation?.locationId;
            const tempLocationEndAt = currentUser?.settings?.temporaryLocation?.endAt;
            const partner1LocationId = currentUser?.partner1?.locationId;
            const currentUserId = currentUser?.id;

            const isTempValid
            = tempLocationId && tempLocationEndAt && new Date(tempLocationEndAt) > new Date();

            // Nếu temp hợp lệ → thay thế location gốc của user bằng temp
            if (isTempValid && currentUserId) {
                const tempLocation = await locationCtr.getLocation(context, {
                    filter: { id: tempLocationId },
                    populate: [{ path: 'entity' }],
                });
                if (tempLocation.success && tempLocation.result) {
                    docs = docs.filter(d => d.entityId !== currentUserId); // loại bản gốc
                    docs.push(tempLocation.result); // thêm temp location
                }
            }

            // Nếu không có temp → check partner1
            if (!isTempValid && partner1LocationId) {
                const partner1Location = await locationCtr.getLocation(context, {
                    filter: { id: partner1LocationId },
                    populate: [{ path: 'entity' }],
                });
                if (partner1Location.success && partner1Location.result) {
                    docs = docs.filter(d => d.id !== partner1LocationId); // tránh trùng
                    docs.push(partner1Location.result);
                }
            }
        }

        // Deduplicate theo entity id
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

        // Rebuild pagination meta
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
            success: true,
            result: newResult,
        };
    },

};
