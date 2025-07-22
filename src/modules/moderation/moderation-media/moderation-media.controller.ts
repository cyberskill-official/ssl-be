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
import { GraphQLError } from 'graphql';

import type { I_User } from '#modules/user/user.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { catalogueCtr, E_CatalogueType } from '#modules/catalogue/index.js';
import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';
import { E_UploadModule } from '#modules/upload/upload.type.js';

import type {
    I_Input_ApproveModerationMedia,
    I_Input_CreateModerationMedia,
    I_Input_QueryModerationMedia,
    I_Input_RejectModerationMedia,
    I_Input_UpdateModerationMedia,
    I_ModerationMedia,
} from './moderation-media.type.js';

import { ModerationMediaModel } from './moderation-media.model.js';
import { E_ModerationMediaStatus } from './moderation-media.type.js';
import { mapModerationMediaTypeTo } from './moderation.util.js';

const mongooseCtr = new MongooseController<I_ModerationMedia>(ModerationMediaModel);

export const moderationMediaCtr = {
    getModerationMedia: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getModerationMedias: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryModerationMedia>,
    ): Promise<I_Return<T_PaginateResult<I_ModerationMedia>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createModerationMedia: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const { module } = doc;

        let moderationCreatedId: string = undefined!;
        try {
            const moderationCreated = await mongooseCtr.createOne({
                ...doc,
                uploadedById: currentUser.id,
                status: E_ModerationMediaStatus.PENDING,
            });

            if (!moderationCreated.success) {
                throwError({
                    message: 'Failed to create moderation media.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            moderationCreatedId = moderationCreated.result.id;

            switch (module) {
                case E_UploadModule.GALLERY: {
                    const galleryCreated = await galleryCtr.createGallery(context, {
                        doc: {
                            moderationMediaId: moderationCreatedId,
                            type: mapModerationMediaTypeTo(moderationCreated.result.type!, E_GalleryType)!,
                            url: moderationCreated.result.url!,
                            uploadedById: moderationCreated.result.uploadedById!,
                            status: moderationCreated.result.status,
                            isPublished: moderationCreated.result.isPublished,
                        },
                    });
                    if (galleryCreated.success && galleryCreated.result?.id) {
                        await mongooseCtr.updateOne(
                            { id: moderationCreatedId },
                            { moduleId: galleryCreated.result.id },
                        );
                    }
                    break;
                }

                case E_UploadModule.CATALOGUE: {
                    if (!moderationCreated.result.tagId) {
                        throwError({
                            message: 'Tag ID is required for catalogue module.',
                            status: RESPONSE_STATUS.BAD_REQUEST,
                        });
                    }

                    const catalogueCreated = await catalogueCtr.createCatalogue(context, {
                        doc: {
                            moderationMediaId: moderationCreatedId,
                            type: mapModerationMediaTypeTo(moderationCreated.result.type!, E_CatalogueType),
                            url: moderationCreated.result.url!,
                            tagId: moderationCreated.result.tagId,
                            status: moderationCreated.result.status,
                        },
                    });
                    if (catalogueCreated.success && catalogueCreated.result?.id) {
                        await mongooseCtr.updateOne(
                            { id: moderationCreatedId },
                            { moduleId: catalogueCreated.result.id },
                        );
                    }
                    break;
                }

                case E_UploadModule.CONVERSATION:
                    // TODO: Handle conversation module if needed
                    break;
                case E_UploadModule.EVENT:
                    // TODO:Handle event module if needed
                    break;
                case E_UploadModule.USER:
                    // TODO: Handle user module if needed
                    break;

                default:
                    throwError({
                        message: `Unsupported module: ${module}`,
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
            }

            return mongooseCtr.findOne({ id: moderationCreatedId });
        }
        catch (error) {
            await mongooseCtr.deleteOne({ id: moderationCreatedId });

            if (error instanceof GraphQLError) {
                throwError({
                    message: error.message,
                    status: {
                        CODE: error.extensions['code'] as string | number,
                        MESSAGE: error.message,
                    },
                });
            }

            throwError({
                message: (error as Error).message || 'Failed to create moderation media.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },

    updateModerationMedia: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    _updateModerationMediaStatus: async (
        context: I_Context,
        moderation: I_ModerationMedia,
        currentUser: I_User,
        status: E_ModerationMediaStatus,
        reason?: string,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const currentStatus = moderation.status;
        const currentModule = moderation.module;

        const isAfterRejectToApprove = currentStatus === E_ModerationMediaStatus.REJECTED && status === E_ModerationMediaStatus.APPROVED;

        try {
            switch (currentModule) {
                case E_UploadModule.CATALOGUE:
                    await catalogueCtr.updateCatalogue(context, {
                        filter: {
                            moderationMediaId: moderation.id,
                        },
                        update: {
                            status,
                        },
                    });
                    break;

                case E_UploadModule.GALLERY:
                    await galleryCtr.updateGallery(context, {
                        filter: {
                            moderationMediaId: moderation.id,
                        },
                        update: {
                            status,
                        },
                    });
                    break;

                case E_UploadModule.CONVERSATION:
                    // TODO: Handle conversation module if needed
                    break;
                case E_UploadModule.EVENT:
                    // TODO:Handle event module if needed
                    break;
                case E_UploadModule.USER:
                    // TODO: Handle user module if needed
                    break;

                default:
                    throwError({
                        message: `Unsupported module type: ${currentModule}`,
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
            }

            return mongooseCtr.updateOne(
                { id: moderation.id },
                {
                    status,
                    moderatedById: currentUser.id,
                    reason: isAfterRejectToApprove ? null : reason,
                },
            );
        }
        catch (error) {
            await mongooseCtr.updateOne(
                { id: moderation.id },
                { status: currentStatus },
            );

            throwError({
                message: (error as Error).message || 'Failed to update moderation media status.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }
    },
    approveModerationMedia: async (
        context: I_Context,
        { id }: I_Input_ApproveModerationMedia,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const currentModerationMedia = await moderationMediaCtr.getModerationMedia(
            context,
            {
                filter: { id },
            },
        );

        if (!currentModerationMedia.success) {
            throwError({
                message: 'ModerationMedia not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        if (currentModerationMedia.result.status === E_ModerationMediaStatus.APPROVED) {
            throwError({
                message: 'ModerationMedia already approved.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const moderationMediaUpdated = await moderationMediaCtr._updateModerationMediaStatus(
            context,
            currentModerationMedia.result,
            currentUser,
            E_ModerationMediaStatus.APPROVED,
        );

        return moderationMediaUpdated;
    },
    rejectModerationMedia: async (
        context: I_Context,
        { id, reason }: I_Input_RejectModerationMedia,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const currentUser = context.req?.session?.user;
        if (!currentUser?.id) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const currentModerationMedia = await mongooseCtr.findOne({ id });
        if (!currentModerationMedia.success || !currentModerationMedia.result) {
            throwError({
                message: 'ModerationMedia not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        if (currentModerationMedia.result.status === E_ModerationMediaStatus.REJECTED) {
            throwError({
                message: 'ModerationMedia already rejected.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const moderationMediaUpdated = await moderationMediaCtr._updateModerationMediaStatus(
            context,
            currentModerationMedia.result,
            currentUser,
            E_ModerationMediaStatus.REJECTED,
            reason,
        );

        return moderationMediaUpdated;
    },
    deleteModerationMedia: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        // Find the moderation media first
        const moderationMedia = await mongooseCtr.findOne(filter);
        if (!moderationMedia.success || !moderationMedia.result) {
            throwError({
                message: 'ModerationMedia not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { module, id } = moderationMedia.result;

        try {
            switch (module) {
                case E_UploadModule.GALLERY:
                    await galleryCtr.deleteGallery(context, {
                        filter: { moderationMediaId: id },
                    });
                    break;
                case E_UploadModule.CATALOGUE:
                    await catalogueCtr.deleteCatalogue(context, {
                        filter: { moderationMediaId: id },
                    });
                    break;
                default:
                    // Do nothing for unsupported modules
                    break;
            }
        }
        catch (error) {
            throwError({
                message: (error as Error).message || 'Failed to delete related module.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return mongooseCtr.deleteOne(filter, options);
    },
};

// Ví dụ sử dụng moderationLogCtr để ghi log khi duyệt media
// import { E_ModerationLogAction } from '../moderation-log/moderation-log.type.js';
//
// await moderationLogCtr.createModerationLog(context, {
//   doc: {
//     action: E_ModerationLogAction.APPROVE,
//     userId: currentUser.id,
//     moderationMediaId: moderationMediaId,
//   }
// });
