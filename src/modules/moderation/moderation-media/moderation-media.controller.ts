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
import { bunnyCtr } from '#modules/bunny/index.js';
import { catalogueCtr, E_CatalogueType } from '#modules/catalogue/index.js';
import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';
import { E_UploadEntity } from '#shared/typescript/index.js';

import type {
    I_Input_ApproveModerationMedia,
    I_Input_CreateModerationMedia,
    I_Input_QueryModerationMedia,
    I_Input_RejectModerationMedia,
    I_Input_UpdateModerationMedia,
    I_ModerationMedia,
} from './moderation-media.type.js';

import { aiModerationCtr } from '../ai-moderation/ai-moderation.controller.js';
import { E_RiskLevel } from '../ai-moderation/ai-moderation.type.js';
import { ModerationMediaModel } from './moderation-media.model.js';
import { E_ModerationMediaStatus, E_ModerationMediaType } from './moderation-media.type.js';
import { mapModerationMediaTypeTo } from './moderation-media.util.js';

const mongooseCtr = new MongooseController<I_ModerationMedia>(ModerationMediaModel);

export const moderationMediaCtr = {
    getModerationMedia: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const moderationMediaFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!moderationMediaFound.success) {
            return moderationMediaFound;
        }

        if (moderationMediaFound.result.url) {
            moderationMediaFound.result.url = bunnyCtr.generateSignedUrl({
                fullUrl: moderationMediaFound.result.url,
                extraQueryParams: {
                    class: 'normal',
                },
            });
            // If the URL is an embed iframe (e.g. mediadelivery embed), also expose it
            // as `embedUrl` so front-end admin UI can render an iframe player instead
            // of attempting to use the url as a video src.
            try {
                if (typeof moderationMediaFound.result.url === 'string' && moderationMediaFound.result.url.includes('/embed/')) {
                    // preserve signed embed url for client consumption
                    (moderationMediaFound.result as any).embedUrl = moderationMediaFound.result.url;
                }
            }
            catch {
                /* non-fatal */
            }
        }

        return moderationMediaFound;
    },
    getModerationMedias: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryModerationMedia>,
    ): Promise<I_Return<T_PaginateResult<I_ModerationMedia>>> => {
        const moderationMedias = await mongooseCtr.findPaging(filter, options);

        if (!moderationMedias.success) {
            return moderationMedias;
        }

        moderationMedias.result.docs = moderationMedias.result.docs.map((moderationMedia) => {
            if (moderationMedia.url) {
                moderationMedia.url = bunnyCtr.generateSignedUrl({
                    fullUrl: moderationMedia.url,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
                try {
                    if (typeof moderationMedia.url === 'string' && moderationMedia.url.includes('/embed/')) {
                        (moderationMedia as any).embedUrl = moderationMedia.url;
                    }
                }
                catch {
                    /* ignore */
                }
            }

            return moderationMedia;
        });

        return moderationMedias;
    },
    createModerationMedia: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const { entity } = doc;

        let moderationCreatedId: string = undefined!;
        try {
            let aiModerationResult = null;
            try {
                if (doc.type === E_ModerationMediaType.IMAGE) {
                    const imageModerationResult = await aiModerationCtr.moderateImage(context, { imageUrl: doc.url });

                    if (imageModerationResult.success) {
                        aiModerationResult = imageModerationResult.result;
                    }
                }
                else if (doc.type === E_ModerationMediaType.VIDEO) {
                    const videoModerationResult = await aiModerationCtr.moderateVideo(context, { videoUrl: doc.url });

                    if (videoModerationResult.success) {
                        aiModerationResult = videoModerationResult.result;
                    }
                }
            }
            catch (error) {
                // Do not block uploads on AI moderation failure; log and continue
                console.warn('AI moderation failed during moderation media creation:', (error as Error)?.message || error);
            }

            let initialStatus = E_ModerationMediaStatus.PENDING;
            let reason: string | undefined;

            const composeReason = (res: any): string | undefined => {
                if (res?.reasons && Array.isArray(res.reasons) && res.reasons.length > 0) {
                    return res.reasons.join(', ');
                }
                if (res?.moderationLabels && Array.isArray(res.moderationLabels) && res.moderationLabels.length > 0) {
                    return res.moderationLabels
                        .map((l: any) => `${l.name}${typeof l.confidence === 'number' ? ` (${l.confidence.toFixed?.(1) ?? l.confidence}%)` : ''}`)
                        .join(', ');
                }
                return undefined;
            };

            if (aiModerationResult) {
                const aiDecision = aiModerationResult.decision as E_ModerationMediaStatus | undefined;
                const aiRiskLevel = aiModerationResult.riskLevel as E_RiskLevel | undefined;
                const aiReason = composeReason(aiModerationResult);
                const shouldAutoReject
                    = aiDecision === E_ModerationMediaStatus.REJECTED
                        || aiRiskLevel === E_RiskLevel.HIGH
                        || aiRiskLevel === E_RiskLevel.CRITICAL;

                if (shouldAutoReject) {
                    initialStatus = E_ModerationMediaStatus.REJECTED;
                    reason = aiReason ? `AI blocked: ${aiReason}` : 'AI blocked: flagged as high risk content';
                }
                else if (aiReason) {
                    reason = `AI flagged for review: ${aiReason}`;
                }
            }

            const moderationCreated = await mongooseCtr.createOne({
                ...doc,
                uploadedById: currentUser.id,
                status: initialStatus,
                reason,
                isPublished: false,
            });

            if (!moderationCreated.success) {
                throwError({
                    message: 'Failed to create moderation media.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            moderationCreatedId = moderationCreated.result.id;

            switch (entity) {
                case E_UploadEntity.GALLERY: {
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
                            { entityId: galleryCreated.result.id },
                        );
                    }
                    break;
                }

                case E_UploadEntity.USER: {
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
                            { entityId: galleryCreated.result.id },
                        );
                    }
                    break;
                }

                case E_UploadEntity.CATALOGUE: {
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
                            { entityId: catalogueCreated.result.id },
                        );
                    }
                    break;
                }

                case E_UploadEntity.CONVERSATION:
                    // TODO: Handle conversation module if needed
                    break;
                case E_UploadEntity.EVENT:
                    // TODO:Handle event module if needed
                    break;

                default:
                    throwError({
                        message: `Unsupported module: ${entity}`,
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
        const currentEntity = moderation.entity;

        const isAfterRejectToApprove = currentStatus === E_ModerationMediaStatus.REJECTED && status === E_ModerationMediaStatus.APPROVED;

        try {
            switch (currentEntity) {
                case E_UploadEntity.CATALOGUE:
                    await catalogueCtr.updateCatalogue(context, {
                        filter: {
                            moderationMediaId: moderation.id,
                        },
                        update: {
                            status,
                        },
                    });
                    break;

                case E_UploadEntity.GALLERY:
                    await galleryCtr.updateGallery(context, {
                        filter: {
                            moderationMediaId: moderation.id,
                        },
                        update: {
                            status,
                            isPublished: status === E_ModerationMediaStatus.APPROVED,
                            ...(status === E_ModerationMediaStatus.APPROVED ? { isDel: false } : {}),
                            ...(status === E_ModerationMediaStatus.REJECTED ? { isDel: true } : {}),
                        },
                    });
                    if (
                        status === E_ModerationMediaStatus.APPROVED
                        && currentStatus !== E_ModerationMediaStatus.APPROVED
                        && moderation.entityId
                    ) {
                        await galleryCtr.notifyGalleryPublished(context, moderation.entityId);
                    }
                    break;

                case E_UploadEntity.CONVERSATION:
                    // TODO: Handle conversation module if needed
                    break;
                case E_UploadEntity.EVENT:
                    // TODO:Handle event module if needed
                    break;
                case E_UploadEntity.USER:
                    await galleryCtr.updateGallery(context, {
                        filter: {
                            moderationMediaId: moderation.id,
                        },
                        update: {
                            status,
                            isPublished: status === E_ModerationMediaStatus.APPROVED,
                            ...(status === E_ModerationMediaStatus.APPROVED ? { isDel: false } : {}),
                            ...(status === E_ModerationMediaStatus.REJECTED ? { isDel: true } : {}),
                        },
                    });
                    break;

                default:
                    throwError({
                        message: `Unsupported module type: ${currentEntity}`,
                        status: RESPONSE_STATUS.BAD_REQUEST,
                    });
            }

            return mongooseCtr.updateOne(
                { id: moderation.id },
                {
                    status,
                    moderatedById: currentUser.id,
                    reason: isAfterRejectToApprove ? null : reason,
                    isPublished: status === E_ModerationMediaStatus.APPROVED,
                    ...(status === E_ModerationMediaStatus.APPROVED ? { isDel: false } : {}),
                    ...(status === E_ModerationMediaStatus.REJECTED ? { isDel: true } : {}),
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
        const currentUser = await authnCtr.getUserFromSession(context);

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

        // Try delete underlying file on Bunny before status update
        const media = currentModerationMedia.result;
        try {
            if (media.type === E_ModerationMediaType.VIDEO && media.url) {
                const deleted = await bunnyCtr.deleteVideoUrl(context, media.url);
                if (!deleted.success) {
                    throw new Error(deleted.message || 'Failed to delete Bunny Stream video');
                }
            }
            else if (media.type === E_ModerationMediaType.IMAGE && media.url) {
                let storagePath = media.url;
                try {
                    const u = new URL(media.url);
                    storagePath = u.pathname.replace(/^\//, '');
                }
                catch {
                    // assume already a storage path
                }
                const deleted = await bunnyCtr.deleteFile(context, storagePath);
                if (!deleted.success) {
                    throw new Error(deleted.message || 'Failed to delete Bunny Storage file');
                }
            }
        }
        catch (error) {
            throwError({
                message: (error as Error).message || 'Failed to delete media file before reject.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
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

        const { entity, id } = moderationMedia.result;

        try {
            switch (entity) {
                case E_UploadEntity.GALLERY:
                    await galleryCtr.deleteGallery(context, {
                        filter: { moderationMediaId: id },
                    });
                    break;
                case E_UploadEntity.USER:
                    await galleryCtr.deleteGallery(context, {
                        filter: { moderationMediaId: id },
                    });
                    break;
                case E_UploadEntity.CATALOGUE:
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
