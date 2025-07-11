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
import { catalogueCtr, E_CatalogueType } from '#modules/catalogue/index.js';
import { E_UploadModule } from '#modules/upload/upload.type.js';

import type { I_Input_ApproveModerationMedia, I_Input_CreateModerationMedia, I_Input_QueryModerationMedia, I_Input_RejectModerationMedia, I_Input_UpdateModerationMedia, I_ModerationMedia } from './moderation-media.type.js';

import { ModerationMediaModel } from './moderation-media.model.js';
import { E_ModerationMediaStatus, E_ModerationMediaType } from './moderation-media.type.js';

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

        return mongooseCtr.createOne({
            ...doc,
            uploadedById: currentUser.id,
            status: E_ModerationMediaStatus.PENDING,
        });
    },
    updateModerationMedia: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    approveModerationMedia: async (
        context: I_Context,
        { id }: I_Input_ApproveModerationMedia,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const currentModerationMedia = await mongooseCtr.findOne({ id });

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

        const moderationMedia = await mongooseCtr.updateOne(
            { id },
            {
                status: E_ModerationMediaStatus.APPROVED,
                moderatedById: currentUser.id,
                notes: [],
            },
        );

        if (!moderationMedia.success || !moderationMedia.result) {
            throwError({
                message: 'ModerationMedia not found or update failed.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const mediaTypeToCatalogueType = {
            [E_ModerationMediaType.IMAGE]: E_CatalogueType.IMAGE,
            [E_ModerationMediaType.VIDEO]: E_CatalogueType.VIDEO,
        };

        const mediaType = moderationMedia.result.type;
        if (mediaType === undefined) {
            throwError({
                message: 'ModerationMedia type is undefined.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
        switch (moderationMedia.result.module) {
            case E_UploadModule.CATALOGUE:
                await catalogueCtr.createCatalogue(
                    context,
                    {
                        doc: {
                            type: mediaTypeToCatalogueType[mediaType],
                            tagId: moderationMedia.result.tagId || '',
                            url: moderationMedia.result.url || '',
                        },
                    },
                );
                break;

            default:
                break;
        }

        return moderationMedia;
    },
    rejectModerationMedia: async (
        context: I_Context,
        { id, notes }: I_Input_RejectModerationMedia,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const currentUser = context.req?.session?.user;
        if (!currentUser?.id) {
            throwError({
                message: 'User not authenticated.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const current = await mongooseCtr.findOne({ id });
        if (!current.success || !current.result) {
            throwError({
                message: 'ModerationMedia not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        if (current.result.status === E_ModerationMediaStatus.REJECTED) {
            throwError({
                message: 'ModerationMedia already rejected.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const oldStatus = current.result.status;

        const moderationMedia = await mongooseCtr.updateOne(
            { id },
            {
                status: E_ModerationMediaStatus.REJECTED,
                moderatedById: currentUser.id,
                notes,
            },
        );

        if (oldStatus === E_ModerationMediaStatus.APPROVED) {
            switch (current.result.module) {
                case E_UploadModule.CATALOGUE:
                    await catalogueCtr.deleteCatalogue(
                        context,
                        {
                            filter: {
                                url: current.result.url || '',
                            },
                        },
                    );
                    break;

                default:
                    break;
            }
        }

        return moderationMedia;
    },
    deleteModerationMedia: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        return mongooseCtr.deleteOne(filter, options);
    },
};
