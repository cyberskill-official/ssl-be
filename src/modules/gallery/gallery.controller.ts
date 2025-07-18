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

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type {
    I_Gallery,
    I_Input_CreateGallery,
    I_Input_IncreaseGalleryViewCount,
    I_Input_LikeGallery,
    I_Input_QueryGallery,
    I_Input_UnlikeGallery,
    I_Input_UpdateGallery,
} from './gallery.type.js';

import { GalleryModel } from './gallery.model.js';

const mongooseCtr = new MongooseController<I_Gallery>(GalleryModel);

export const galleryCtr = {
    getGallery: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getGalleries: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryGallery>,
    ): Promise<I_Return<T_PaginateResult<I_Gallery>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createGallery: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        return mongooseCtr.createOne(doc);
    },
    updateGallery: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteGallery: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        return mongooseCtr.deleteOne(filter, options);
    },
    likeGallery: async (
        context: I_Context,
        { id }: I_Input_LikeGallery,
    ): Promise<I_Return<I_Gallery>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const galleryFound = await galleryCtr.getGallery(context, {
            filter: { id },
            projection: { id: 1, likedByIds: 1 },
        });

        if (!galleryFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Gallery not found',
            });
        }

        if (galleryFound.result.likedByIds?.includes(currentUser.id)) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'You have already liked this gallery',
            });
        }

        return mongooseCtr.updateOne(
            { id },
            { $addToSet: { likedByIds: currentUser.id } },
        );
    },
    unlikeGallery: async (
        context: I_Context,
        { id }: I_Input_UnlikeGallery,
    ): Promise<I_Return<I_Gallery>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const galleryFound = await galleryCtr.getGallery(context, {
            filter: { id },
            projection: { id: 1, likedByIds: 1 },
        });

        if (!galleryFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Gallery not found',
            });
        }

        if (!galleryFound.result.likedByIds?.includes(currentUser.id)) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'You have not liked this gallery yet',
            });
        }

        return mongooseCtr.updateOne(
            { id },
            { $pull: { likedByIds: currentUser.id } },
        );
    },
    increaseGalleryViewCount: async (
        context: I_Context,
        { id }: I_Input_IncreaseGalleryViewCount,
    ): Promise<I_Return<I_Gallery>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const incResult = await mongooseCtr.updateOne(
            { id, 'isDel': false, 'views.viewById': currentUser.id },
            { $inc: { 'views.$.viewCount': 1 } },
        );

        if (incResult.success) {
            return incResult;
        }

        return mongooseCtr.updateOne(
            { id, isDel: false },
            { $push: { views: { viewById: currentUser.id, viewCount: 1 } } },
        );
    },
};
