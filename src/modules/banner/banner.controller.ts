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

import type { I_Banner, I_Input_CreateBanner, I_Input_QueryBanner, I_Input_UpdateBanner } from './banner.type.js';

import { BannerModel } from './banner.model.js';

const mongooseCtr = new MongooseController<I_Banner>(BannerModel);

export const bannerCtr = {
    getBanner: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryBanner>,
    ): Promise<I_Return<I_Banner>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getBanners: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryBanner>,
    ): Promise<I_Return<T_PaginateResult<I_Banner>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createBanner: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateBanner>,
    ): Promise<I_Return<I_Banner>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!doc.image?.trim()) {
            throwError({ message: 'Banner image is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (!doc.targetURL?.trim() || !validator.isURL(doc.targetURL)) {
            throwError({ message: 'Valid target URL is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return mongooseCtr.createOne({ ...doc, createdById: currentUser.id });
    },
    updateBanner: async (
        context: I_Context,
        { filter, update }: I_Input_UpdateOne<I_Input_UpdateBanner>,
    ): Promise<I_Return<I_Banner>> => {
        if (update?.targetURL?.trim() && !validator.isURL(update.targetURL)) {
            throwError({ message: 'Invalid target URL format', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (update.image) {
            const existingBanner = await bannerCtr.getBanner(context, { filter });

            if (existingBanner.success && existingBanner.result?.image && existingBanner.result.image !== update.image) {
                await bunnyCtr.deleteFile(context, existingBanner.result.image);
            }
        }

        return mongooseCtr.updateOne(filter, update);
    },
    deleteBanner: async (
        context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_QueryBanner>,
    ): Promise<I_Return<I_Banner>> => {
        const bannerFound = await bannerCtr.getBanner(context, { filter });

        if (bannerFound.success && bannerFound.result?.image) {
            await bunnyCtr.deleteFile(context, bannerFound.result.image);
        }

        return mongooseCtr.deleteOne(filter);
    },
    clickBanner: async (
        _context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryBanner>,
    ): Promise<I_Return<I_Banner>> => {
        return mongooseCtr.updateOne(
            { id: filter.id },
            { $inc: { clickCount: 1 } },
            { new: true },
        );
    },
};
