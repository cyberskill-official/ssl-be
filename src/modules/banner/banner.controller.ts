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
import { blogCtr } from '#modules/blog/blog.controller.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { destinationCtr } from '#modules/destination/destination.controller.js';

import type { I_Banner, I_Input_CreateBanner, I_Input_QueryBanner, I_Input_UpdateBanner } from './banner.type.js';

import { BannerModel } from './banner.model.js';
import { mergeBannerPopulate } from './banner.populate.js';

const mongooseCtr = new MongooseController<I_Banner>(BannerModel);

export const bannerCtr = {
    getBanner: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryBanner>,
    ): Promise<I_Return<I_Banner>> => {
        return mongooseCtr.findOne(filter, projection, options, mergeBannerPopulate(populate));
    },
    getBanners: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryBanner>,
    ): Promise<I_Return<T_PaginateResult<I_Banner>>> => {
        return mongooseCtr.findPaging(filter, options ? { ...options, populate: mergeBannerPopulate(options.populate) } : { populate: mergeBannerPopulate() });
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

        const resolvedBlogId = doc.blogId?.trim();
        const resolvedDestinationId = doc.destinationId?.trim();

        if (!!resolvedBlogId === !!resolvedDestinationId) {
            throwError({ message: 'Banner must belong to exactly one blog or one destination', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (resolvedDestinationId) {
            const destinationFound = await destinationCtr.getDestination(context, {
                filter: {
                    id: resolvedDestinationId,
                    isActive: true,
                },
            });

            if (!destinationFound.success || !destinationFound.result?.id) {
                throwError({ message: `Destination ${resolvedDestinationId} does not exist or is inactive`, status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (resolvedBlogId) {
            const blogFound = await blogCtr.getBlog(context, {
                filter: {
                    id: resolvedBlogId,
                    isActive: true,
                },
            });

            if (!blogFound.success || !blogFound.result?.id) {
                throwError({ message: `Blog ${resolvedBlogId} does not exist or is inactive`, status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        const createdBanner = await mongooseCtr.createOne({ ...doc, createdById: currentUser.id });

        if (!createdBanner.success || !createdBanner.result?.id) {
            return createdBanner;
        }

        return bannerCtr.getBanner(context, { filter: { id: createdBanner.result.id } });
    },
    updateBanner: async (
        context: I_Context,
        { filter, update }: I_Input_UpdateOne<I_Input_UpdateBanner>,
    ): Promise<I_Return<I_Banner>> => {
        if (Object.hasOwn(update, 'image') && !update.image?.trim()) {
            throwError({ message: 'Banner image cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (Object.hasOwn(update, 'targetURL')) {
            if (!update.targetURL?.trim()) {
                throwError({ message: 'Banner target URL cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
            }

            if (!validator.isURL(update.targetURL)) {
                throwError({ message: 'Invalid target URL format', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (Object.hasOwn(update, 'blogId') || Object.hasOwn(update, 'destinationId')) {
            const existingBanner = await bannerCtr.getBanner(context, { filter });

            if (!existingBanner.success || !existingBanner.result) {
                throwError({ message: 'Banner not found', status: RESPONSE_STATUS.NOT_FOUND });
            }

            const resolvedBlogId = update.blogId ?? existingBanner.result.blogId;
            const resolvedDestinationId = update.destinationId ?? existingBanner.result.destinationId;

            if (!!resolvedBlogId === !!resolvedDestinationId) {
                throwError({ message: 'Banner must belong to exactly one blog or one destination', status: RESPONSE_STATUS.BAD_REQUEST });
            }

            if (resolvedDestinationId) {
                const destinationFound = await destinationCtr.getDestination(context, {
                    filter: {
                        id: resolvedDestinationId,
                        isActive: true,
                    },
                });

                if (!destinationFound.success || !destinationFound.result?.id) {
                    throwError({ message: `Destination ${resolvedDestinationId} does not exist or is inactive`, status: RESPONSE_STATUS.BAD_REQUEST });
                }
            }

            if (resolvedBlogId) {
                const blogFound = await blogCtr.getBlog(context, {
                    filter: {
                        id: resolvedBlogId,
                        isActive: true,
                    },
                });

                if (!blogFound.success || !blogFound.result?.id) {
                    throwError({ message: `Blog ${resolvedBlogId} does not exist or is inactive`, status: RESPONSE_STATUS.BAD_REQUEST });
                }
            }
        }

        if (update.image) {
            const existingBanner = await bannerCtr.getBanner(context, { filter });

            if (existingBanner.success && existingBanner.result?.image && existingBanner.result.image !== update.image) {
                await bunnyCtr.deleteFile(context, existingBanner.result.image);
            }
        }

        const updatedBanner = await mongooseCtr.updateOne(filter, update);

        if (!updatedBanner.success || !updatedBanner.result?.id) {
            return updatedBanner;
        }

        return bannerCtr.getBanner(context, { filter: { id: updatedBanner.result.id } });
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
        context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryBanner>,
    ): Promise<I_Return<I_Banner>> => {
        if (typeof filter?.id !== 'string' || !filter.id.trim()) {
            throwError({ message: 'Banner id is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const bannerFound = await bannerCtr.getBanner(context, {
            filter: { ...filter, isActive: true, isDel: false },
        });

        if (!bannerFound.success || !bannerFound.result?.id) {
            throwError({ message: 'Active banner not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        return mongooseCtr.updateOne(
            { id: bannerFound.result.id },
            { $inc: { clickCount: 1 } },
            { new: true },
        );
    },
};
