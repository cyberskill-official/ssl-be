import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import validator from 'validator';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/authn.controller.js';
import { bunnyCtr } from '#modules/bunny/index.js';

import type { I_Advertisement, I_Input_CreateAdvertisement, I_Input_QueryAdvertisement, I_Input_UpdateAdvertisement, I_Input_UpdateClickCount } from './advertisement.type.js';

import { AdvertisementModel } from './advertisement.model.js';

const mongooseCtr = new MongooseController<I_Advertisement>(AdvertisementModel);

export const advertisementCtr = {
    getAdvertisement: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getAdvertisements: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<T_PaginateResult<I_Advertisement>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createAdvertisement: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!doc.name?.trim()) {
            throwError({ message: 'Advertisement name is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.image?.trim()) {
            throwError({ message: 'Advertisement image is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.targetURL?.trim() || !validator.isURL(doc.targetURL)) {
            throwError({ message: 'Valid target URL is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (doc.slot) {
            const existingSlot = await advertisementCtr.getAdvertisement(
                context,
                { filter: { slot: doc.slot } },
            );

            if (existingSlot.success && existingSlot.result) {
                throwError({ message: `Slot ${doc.slot} is already taken by another advertisement`, status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (doc.startDate && doc.endDate) {
            if (new Date(doc.endDate) <= new Date(doc.startDate)) {
                throwError({ message: 'End date cannot be before or equal to start date', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (doc.isActive) {
            const activeCount = await advertisementCtr.getAdvertisements(
                context,
                { filter: { isActive: true, isDel: false } },
            );

            if (!activeCount.success) {
                throwError({ message: activeCount.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            if (activeCount.result.totalDocs >= 4) {
                throwError({ message: 'Cannot have more than 4 active advertisements', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        return mongooseCtr.createOne({ ...doc, createdById: currentUser.id });
    },
    updateAdvertisement: async (
        context: I_Context,
        { filter, update }: I_Input_UpdateOne<I_Input_UpdateAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        if (!update?.name?.trim()) {
            throwError({ message: 'Advertisement name cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!update?.image?.trim()) {
            throwError({ message: 'Advertisement image cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update?.targetURL?.trim() && !validator.isURL(update?.targetURL)) {
            throwError({ message: 'Invalid target URL format', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.slot) {
            const existingSlot = await advertisementCtr.getAdvertisement(
                context,
                { filter: { slot: update.slot, id: { $ne: filter['id'] } } },
            );

            if (existingSlot.success && existingSlot.result) {
                throwError({ message: `Slot ${update.slot} is already taken by another advertisement`, status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (update.startDate && update.endDate) {
            if (new Date(update.endDate) <= new Date(update.startDate)) {
                throwError({ message: 'End date cannot be before or equal to start date', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (update.isActive) {
            const activeCount = await advertisementCtr.getAdvertisements(
                context,
                { filter: { isActive: true, id: { $ne: filter['id'] } } },
            );

            if (!activeCount.success) {
                throwError({ message: activeCount.message, status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            if (activeCount.result.totalDocs >= 4) {
                throwError({ message: 'Cannot have more than 4 active advertisements', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (update.image) {
            const existingAdvertisement = await advertisementCtr.getAdvertisement(context, { filter });

            if (existingAdvertisement.success && existingAdvertisement.result.image) {
                const imageDeleted = await bunnyCtr.deleteFile(context, existingAdvertisement.result.image);

                if (!imageDeleted.success) {
                    throwError({
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                        message: imageDeleted.message,
                    });
                }
            }
        }

        return mongooseCtr.updateOne(filter, update);
    },
    deleteAdvertisement: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        const advertisementFound = await advertisementCtr.getAdvertisement(context, { filter });

        if (advertisementFound.success && advertisementFound.result.image) {
            const imageDeleted = await bunnyCtr.deleteFile(context, advertisementFound.result.image);

            if (!imageDeleted.success) {
                throwError({
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    message: imageDeleted.message,
                });
            }
        }

        return mongooseCtr.deleteOne(filter);
    },
    clickAdvertisement: async (
        _context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryAdvertisement>,
    ): Promise<I_Return<I_Advertisement>> => {
        return mongooseCtr.updateOne(
            { id: filter.id },
            { $inc: { clickCount: 1 } },
            { new: true },
        );
    },
    updateClickCount: async (
        _context: I_Context,
        { filter, update }: I_Input_UpdateOne<I_Input_UpdateClickCount>,
    ): Promise<I_Return<I_Advertisement>> => {
        const existingAd = await advertisementCtr.getAdvertisement(
            _context,
            { filter },
        );

        if (!existingAd.success) {
            throwError({ message: 'Advertisement not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        return mongooseCtr.updateOne(filter, { clickCount: update.clickCount });
    },
};
