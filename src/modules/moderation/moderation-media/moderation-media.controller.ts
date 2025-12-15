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
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { GraphQLError } from 'graphql';

import type { I_User } from '#modules/user/user.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { catalogueCtr, E_CatalogueType } from '#modules/catalogue/index.js';
import { E_MessageType, messageCtr, MessageModel } from '#modules/conversation/index.js';
import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';
import { E_NoteType } from '#modules/note/note.type.js';
import { userCtr } from '#modules/user/index.js';
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
import { moderationLogCtr } from '../moderation-log/moderation-log.controller.js';
import { E_ModerationLogAction, E_ModerationLogType } from '../moderation-log/moderation-log.type.js';
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
            const rawUrl = moderationMediaFound.result.url as string;
            try {
                if (typeof rawUrl === 'string' && rawUrl.includes('/embed/')) {
                    // Use embed-specific signer for Bunny Stream iframe URLs so the
                    // returned token is valid for the embed endpoint. Also expose it
                    // as `embedUrl` so the admin UI can render an iframe player.
                    try {
                        moderationMediaFound.result.url = bunnyCtr.generateEmbedIframeUrlFromUrl({
                            fullUrl: rawUrl,
                            extraQueryParams: {
                                class: 'normal',
                            },
                        });
                        (moderationMediaFound.result as any).embedUrl = moderationMediaFound.result.url;
                    }
                    catch {
                        // Fall back to generic signed URL if embed signing fails for any reason.
                        moderationMediaFound.result.url = bunnyCtr.generateSignedUrl({
                            fullUrl: rawUrl,
                            extraQueryParams: { class: 'normal' },
                        });
                    }
                }
                else {
                    moderationMediaFound.result.url = bunnyCtr.generateSignedUrl({
                        fullUrl: rawUrl,
                        extraQueryParams: {
                            class: 'normal',
                        },
                    });
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
                const rawUrl = moderationMedia.url as string;
                try {
                    if (typeof rawUrl === 'string' && rawUrl.includes('/embed/')) {
                        try {
                            moderationMedia.url = bunnyCtr.generateEmbedIframeUrlFromUrl({
                                fullUrl: rawUrl,
                                extraQueryParams: {
                                    class: 'normal',
                                },
                            });
                            (moderationMedia as any).embedUrl = moderationMedia.url;
                        }
                        catch {
                            moderationMedia.url = bunnyCtr.generateSignedUrl({ fullUrl: rawUrl, extraQueryParams: { class: 'normal' } });
                        }
                    }
                    else {
                        moderationMedia.url = bunnyCtr.generateSignedUrl({
                            fullUrl: rawUrl,
                            extraQueryParams: {
                                class: 'normal',
                            },
                        });
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
            // If uploader is staff/admin, bypass AI moderation and auto-approve.
            let aiModerationResult = null;
            let isStaff = false;
            let isAdmin = false;
            try {
                isStaff = await authnCtr.isStaff(context);
            }
            catch {
                isStaff = false;
            }
            try {
                isAdmin = await authnCtr.isAdmin(context);
            }
            catch {
                isAdmin = false;
            }

            const bypassAiModeration = isStaff || isAdmin;

            if (!bypassAiModeration) {
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
                    log.warn('AI moderation failed during moderation media creation:', (error as Error)?.message || error);
                }
            }

            let initialStatus = E_ModerationMediaStatus.PENDING;
            let reason: string | undefined;
            // Bypass AI still skips AI call but no longer auto-approves; keep PENDING for manual review
            if (typeof bypassAiModeration !== 'undefined' && bypassAiModeration) {
                reason = 'Bypassed AI moderation: uploaded by staff/admin';
            }

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
                else if (aiDecision === E_ModerationMediaStatus.APPROVED) {
                    // Auto-approve when AI explicitly approves
                    initialStatus = E_ModerationMediaStatus.APPROVED;
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
                isPublished: initialStatus === E_ModerationMediaStatus.APPROVED,
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
                        doc: Object.assign({
                            moderationMediaId: moderationCreatedId,
                            type: mapModerationMediaTypeTo(moderationCreated.result.type!, E_GalleryType)!,
                            url: moderationCreated.result.url!,
                            uploadedById: moderationCreated.result.uploadedById!,
                            status: moderationCreated.result.status,
                            isPublished: moderationCreated.result.isPublished,
                        }, (moderationCreated.result.thumbnailUrl ? { thumbnailUrl: moderationCreated.result.thumbnailUrl } : {})),
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
                        doc: Object.assign({
                            moderationMediaId: moderationCreatedId,
                            type: mapModerationMediaTypeTo(moderationCreated.result.type!, E_GalleryType)!,
                            url: moderationCreated.result.url!,
                            uploadedById: moderationCreated.result.uploadedById!,
                            status: moderationCreated.result.status,
                            isPublished: moderationCreated.result.isPublished,
                        }, (moderationCreated.result.thumbnailUrl ? { thumbnailUrl: moderationCreated.result.thumbnailUrl } : {})),
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
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateModerationMedia>,
    ): Promise<I_Return<I_ModerationMedia>> => {
        // If status is being changed, delegate to _updateModerationMediaStatus to keep entity (gallery, etc.) in sync
        if (update?.status !== undefined) {
            const moderationRes = await mongooseCtr.findOne(filter);
            if (!moderationRes.success || !moderationRes.result) {
                throwError({
                    message: 'ModerationMedia not found.',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }
            // Require an authenticated user for audit trail
            const currentUser = await authnCtr.getUserFromSession(context);

            return moderationMediaCtr._updateModerationMediaStatus(
                context,
                moderationRes.result,
                currentUser,
                update.status as E_ModerationMediaStatus,
                (update as any).reason,
            );
        }

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

                case E_UploadEntity.GALLERY: {
                    const galleryUpdate = {
                        status,
                        isPublished: status === E_ModerationMediaStatus.APPROVED,
                        ...(status === E_ModerationMediaStatus.APPROVED ? { isDel: false } : {}),
                        ...(status === E_ModerationMediaStatus.REJECTED ? { isDel: true } : {}),
                    };
                    log.warn('[MODERATION][GALLERY] applying status update', {
                        moderationId: moderation.id,
                        entityId: moderation.entityId,
                        status,
                        galleryUpdate,
                    });
                    await galleryCtr.updateGallery(context, {
                        filter: { moderationMediaId: moderation.id },
                        update: galleryUpdate,
                    });
                    // Fallback: if entityId present, force update by id as well
                    if (moderation.entityId) {
                        await galleryCtr.updateGallery(context, {
                            filter: { id: moderation.entityId },
                            update: galleryUpdate,
                        });
                    }
                    log.warn('[MODERATION][GALLERY] status update applied', {
                        moderationId: moderation.id,
                        entityId: moderation.entityId,
                        status,
                    });
                    if (
                        status === E_ModerationMediaStatus.APPROVED
                        && currentStatus !== E_ModerationMediaStatus.APPROVED
                        && moderation.entityId
                    ) {
                        await galleryCtr.notifyGalleryPublished(context, moderation.entityId);
                    }
                    break;
                }

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

            // Restore messages when media is approved (from REJECTED or PENDING)
            // Also create new message if no message exists yet
            if (status === E_ModerationMediaStatus.APPROVED && moderation.url) {
                try {
                    // Get raw URL from database (without signed token/expires)
                    // The moderation.url might be signed, so we need to get the raw URL from DB
                    let mediaUrl = moderation.url as string;

                    // If URL contains token/expires parameters, remove them to get raw URL
                    try {
                        const urlObj = new URL(mediaUrl);
                        // Remove token, expires, and class parameters to get base URL
                        urlObj.searchParams.delete('token');
                        urlObj.searchParams.delete('expires');
                        urlObj.searchParams.delete('class');
                        mediaUrl = urlObj.toString();
                    }
                    catch {
                        // If URL parsing fails, use original URL
                    }

                    // Also try to get raw URL directly from database
                    const rawModerationMedia = await mongooseCtr.findOne({ id: moderation.id }, { url: 1 });
                    if (rawModerationMedia.success && rawModerationMedia.result?.url) {
                        mediaUrl = rawModerationMedia.result.url as string;
                    }
                    // Find redacted messages from this user that were created around the time moderation was created
                    // Since content.value was cleared when redacted, we find by time window and user
                    const moderationCreatedAt = moderation.createdAt
                        ? (typeof moderation.createdAt === 'string' ? new Date(moderation.createdAt) : moderation.createdAt)
                        : new Date();

                    // Find all messages with IMAGE/VIDEO type from this user
                    // Since content.value was cleared when redacted, we can't match by URL
                    // We'll search in a wider time window (up to 1 hour before and after moderation)
                    // If still not found, search all redacted messages from this user in the last 24 hours
                    const expandedTimeWindowStart = new Date(moderationCreatedAt.getTime() - 60 * 60 * 1000); // 1 hour before
                    const expandedTimeWindowEnd = new Date(moderationCreatedAt.getTime() + 60 * 60 * 1000); // 1 hour after

                    // First, try to find messages by URL (if message was created before rejection)
                    // Extract base URL pattern to match messages
                    let baseUrl = mediaUrl;
                    let pathname = '';
                    try {
                        const url = new URL(mediaUrl);
                        pathname = url.pathname;
                        baseUrl = `${url.protocol}//${url.hostname}${pathname}`;
                    }
                    catch {
                        // If URL parsing fails, use original URL
                    }

                    const urlConditions: any[] = [
                        { 'content.value': mediaUrl },
                        { 'content.value': baseUrl },
                    ];
                    if (pathname) {
                        urlConditions.push({ 'content.value': { $regex: pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } });
                    }

                    // First: update statusMedia on all messages that reference this media URL
                    // (so FE sees latest APPROVED/REJECTED/PENDING state)
                    const messageMongooseCtr = new MongooseController(MessageModel);
                    try {
                        await messageMongooseCtr.updateMany(
                            {
                                senderId: moderation.uploadedById,
                                $or: urlConditions,
                            },
                            { statusMedia: status },
                        );
                    }
                    catch {
                        // Non-fatal: if statusMedia update fails, continue with restore logic
                    }

                    // Then: try to find messages by URL first (most accurate) for possible restore

                    // Query directly to bypass any filters in getMessages
                    const messagesByUrl = await messageMongooseCtr.findPaging(
                        {
                            senderId: moderation.uploadedById,
                            isDel: { $ne: true }, // Only exclude hard deleted
                            $and: [
                                { $or: urlConditions },
                                {
                                    $or: [
                                        { 'content.type': E_MessageType.IMAGE },
                                        { 'content.type': E_MessageType.VIDEO },
                                    ],
                                },
                            ],
                        },
                        { pagination: false },
                    );

                    let allMessages = messagesByUrl;

                    // If no messages found by URL, try time window search
                    if (!allMessages.success || !allMessages.result?.docs || allMessages.result.docs.length === 0) {
                        allMessages = await messageCtr.getMessages(context, {
                            filter: {
                                senderId: moderation.uploadedById,
                                createdAt: {
                                    $gte: expandedTimeWindowStart,
                                    $lte: expandedTimeWindowEnd,
                                },
                                $or: [
                                    { 'content.type': E_MessageType.IMAGE },
                                    { 'content.type': E_MessageType.VIDEO },
                                ],
                            },
                            options: { pagination: false },
                        });
                    }

                    // If no messages found in time window, search all redacted/deleted messages from this user in last 24 hours
                    if (!allMessages.success || !allMessages.result?.docs || allMessages.result.docs.length === 0) {
                        const last24Hours = new Date(moderationCreatedAt.getTime() - 24 * 60 * 60 * 1000);

                        allMessages = await messageCtr.getMessages(context, {
                            filter: {
                                senderId: moderation.uploadedById,
                                createdAt: {
                                    $gte: last24Hours,
                                },
                                $and: [
                                    {
                                        $or: [
                                            { 'content.type': E_MessageType.IMAGE },
                                            { 'content.type': E_MessageType.VIDEO },
                                        ],
                                    },
                                    {
                                        $or: [
                                            { redacted: true },
                                            { deletedAt: { $exists: true, $ne: null } },
                                            { 'content.value': '' },
                                        ],
                                    },
                                ],
                            },
                            options: { pagination: false },
                        });
                    }

                    // Filter messages that are redacted, deleted, or have empty content.value (indicating they were redacted)
                    const redactedMessages = allMessages.success && allMessages.result?.docs
                        ? {
                                success: true,
                                result: {
                                    docs: allMessages.result.docs.filter((msg: any) => {
                                        // Check if message is redacted, deleted, or has empty content.value
                                        const isRedacted = msg.redacted === true;
                                        const isDeleted = msg.deletedAt && msg.deletedAt !== null;
                                        const hasEmptyContent = !msg.content?.value || msg.content.value === '';
                                        const shouldRestore = isRedacted || isDeleted || hasEmptyContent;

                                        return shouldRestore;
                                    }),
                                    totalDocs: 0,
                                },
                            }
                        : { success: false, result: { docs: [] } };

                    if (redactedMessages.success && redactedMessages.result?.docs && redactedMessages.result.docs.length > 0) {
                        const messageIds = redactedMessages.result.docs.map(msg => msg.id).filter(Boolean);

                        if (messageIds.length > 0) {
                            // Restore all messages - set URL from moderationMedia
                            // Use mongooseCtr directly to bypass permission check
                            const messageMongooseCtr = new MongooseController(MessageModel);

                            for (const messageId of messageIds) {
                                try {
                                    await messageMongooseCtr.updateOne(
                                        { id: messageId },
                                        {
                                            $unset: {
                                                deletedAt: '',
                                                expiresAt: '',
                                            },
                                            $set: {
                                                'redacted': false,
                                                'content.value': mediaUrl, // Restore URL from moderationMedia
                                            },
                                        },
                                    );
                                }
                                catch {
                                    // Failed to restore message - continue with other messages
                                }
                            }
                        }
                    }
                    // If no redacted/deleted messages were found, do NOT create new messages.
                    // Manual approval should only change the moderation status; message creation is handled at upload time.
                }
                catch (error) {
                    // Log error but don't block moderation flow
                    log.error('Failed to restore messages with approved media', {
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        moderationMediaId: moderation.id,
                    });
                }
            }

            // Red-flag profile when moderation is rejected (manual flow)
            // Only flag if confidence > 70% or risk level is HIGH/CRITICAL
            if (status === E_ModerationMediaStatus.REJECTED && moderation.uploadedById) {
                // Get AI result from moderation log to check confidence/risk level
                let shouldFlag = false;
                try {
                    const moderationLogs = await moderationLogCtr.getModerationLogs(context, {
                        filter: {
                            moderationMediaId: moderation.id,
                        },
                        options: { pagination: false, sort: { createdAt: -1 } },
                    });

                    if (moderationLogs.success && moderationLogs.result?.docs) {
                        // Find the most recent log with AI result
                        const logWithAiResult = moderationLogs.result.docs.find(
                            log => log.aiResult && (log.aiResult.confidence !== undefined || log.aiResult.riskLevel),
                        );

                        if (logWithAiResult?.aiResult) {
                            const aiResult = logWithAiResult.aiResult;
                            const confidence = aiResult.confidence;
                            const riskLevel = aiResult.riskLevel;

                            // Flag only if confidence > 70% or risk level is HIGH/CRITICAL
                            shouldFlag = (confidence !== undefined && confidence > 0.7)
                                || riskLevel === E_RiskLevel.HIGH
                                || riskLevel === E_RiskLevel.CRITICAL;
                        }
                        else {
                            // If no AI result found, don't flag (manual rejection without AI data)
                            shouldFlag = false;
                        }
                    }
                }
                catch {
                    // If error getting logs, don't flag to be safe
                    shouldFlag = false;
                }

                if (shouldFlag) {
                    const noteContent = reason?.trim() || 'Media rejected by moderator.';
                    try {
                        await userCtr.updateUser(context, {
                            filter: { id: moderation.uploadedById },
                            update: {
                                $inc: { flagCount: 1 },
                                $push: {
                                    notes: {
                                        type: E_NoteType.AUTOMATED_DETECTION,
                                        content: noteContent,
                                        createdAt: new Date(),
                                    },
                                },
                            } as any,
                        });
                    }
                    catch {
                        /* best-effort; do not block moderation flow */
                    }
                }
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

        // Check if there's already a manual APPROVE log (created by a moderator, not AI)
        // We allow multiple APPROVE logs to track both AI auto-approval and manual approval
        const existingApproveLogs = await moderationLogCtr.getModerationLogs(context, {
            filter: {
                moderationMediaId: id,
                action: E_ModerationLogAction.APPROVE,
            },
            options: { pagination: false },
        });

        // Check if there's already a manual APPROVE log from this moderator
        const hasManualApproveLog = existingApproveLogs.success
            && existingApproveLogs.result?.docs
            && existingApproveLogs.result.docs.some(
                log => log.reason && log.reason.includes('Approved by moderator'),
            );

        // If moderation media is already APPROVED AND there's already a manual APPROVE log from this moderator, treat as idempotent success
        // But allow changing from REJECTED to APPROVED (override AI rejection)
        if (
            currentModerationMedia.result.status === E_ModerationMediaStatus.APPROVED
            && hasManualApproveLog
        ) {
            return {
                success: true,
                message: 'ModerationMedia already approved by moderator.',
                result: currentModerationMedia.result,
            };
        }

        // If status is already APPROVED (by AI) but no manual log, create log for tracking
        // This allows moderators to approve even if AI has already approved, for audit trail purposes
        if (
            currentModerationMedia.result.status === E_ModerationMediaStatus.APPROVED
            && !hasManualApproveLog
        ) {
            try {
                // Create APPROVE log for manual approval tracking
                const mediaType = currentModerationMedia.result.type
                    ? (currentModerationMedia.result.type === E_ModerationMediaType.VIDEO ? E_ModerationLogType.VIDEO : E_ModerationLogType.IMAGE)
                    : E_ModerationLogType.IMAGE;
                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: E_ModerationLogAction.APPROVE,
                        type: mediaType, // Set type to IMAGE or VIDEO
                        userId: currentModerationMedia.result.uploadedById || currentUser.id,
                        moderationMediaId: id,
                        reason: 'Approved by moderator (manual approval)',
                    },
                });
            }
            catch {
                // Log error but don't block - moderation log creation failure shouldn't prevent response
            }

            // Return the existing moderation media since it's already approved
            return {
                success: true,
                message: 'ModerationMedia approved (manual approval log created).',
                result: currentModerationMedia.result,
            };
        }

        // If status is REJECTED, allow changing to APPROVED (override AI rejection)
        // This allows moderators to approve even if AI has rejected

        // Update moderation media status (status is not APPROVED yet, so this is a new approval)
        const moderationMediaUpdated = await moderationMediaCtr._updateModerationMediaStatus(
            context,
            currentModerationMedia.result,
            currentUser,
            E_ModerationMediaStatus.APPROVED,
        );

        // Create APPROVE log if it doesn't exist yet
        if (moderationMediaUpdated.success && moderationMediaUpdated.result) {
            try {
                // Check again if log was created between the check and the update
                const checkLogsAgain = await moderationLogCtr.getModerationLogs(context, {
                    filter: {
                        moderationMediaId: id,
                        action: E_ModerationLogAction.APPROVE,
                    },
                    options: { pagination: false },
                });

                if (
                    !checkLogsAgain.success
                    || !checkLogsAgain.result?.docs
                    || checkLogsAgain.result.docs.length === 0
                ) {
                    // No APPROVE log exists, create one
                    const mediaType = currentModerationMedia.result.type
                        ? (currentModerationMedia.result.type === E_ModerationMediaType.VIDEO ? E_ModerationLogType.VIDEO : E_ModerationLogType.IMAGE)
                        : E_ModerationLogType.IMAGE;
                    await moderationLogCtr.createModerationLog(context, {
                        doc: {
                            action: E_ModerationLogAction.APPROVE,
                            type: mediaType, // Set type to IMAGE or VIDEO
                            userId: currentModerationMedia.result.uploadedById || currentUser.id,
                            moderationMediaId: id,
                            reason: 'Approved by moderator',
                        },
                    });
                }
            }
            catch {
                // Log error but don't block - moderation log creation failure shouldn't prevent response
                // The moderation media is already approved, so this is just for audit trail
            }
        }

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

        // Check if there's already a manual DELETE log (created by a moderator, not AI)
        // We allow multiple DELETE logs to track both AI auto-rejection and manual rejection
        const existingDeleteLogs = await moderationLogCtr.getModerationLogs(context, {
            filter: {
                moderationMediaId: id,
                action: E_ModerationLogAction.DELETE,
            },
            options: { pagination: false },
        });

        // Check if there's already a manual DELETE log from this moderator
        const hasManualDeleteLog = existingDeleteLogs.success
            && existingDeleteLogs.result?.docs
            && existingDeleteLogs.result.docs.some(
                log => log.reason && (log.reason.includes('Rejected by moderator') || log.reason.includes('rejected by moderator')),
            );

        // If moderation media is already REJECTED AND there's already a manual DELETE log from this moderator, treat as idempotent success
        // But allow changing from APPROVED to REJECTED (override AI approval)
        if (
            currentModerationMedia.result.status === E_ModerationMediaStatus.REJECTED
            && hasManualDeleteLog
        ) {
            throwError({
                message: 'ModerationMedia already rejected by moderator.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // If status is already REJECTED (by AI) but no manual log, create log for tracking
        // This allows moderators to reject even if AI has already rejected, for audit trail purposes
        // Skip file deletion since it's already been deleted
        if (
            currentModerationMedia.result.status === E_ModerationMediaStatus.REJECTED
            && !hasManualDeleteLog
        ) {
            try {
                // Create DELETE log for manual rejection tracking
                const mediaType = currentModerationMedia.result.type
                    ? (currentModerationMedia.result.type === E_ModerationMediaType.VIDEO ? 'VIDEO' : 'IMAGE')
                    : 'IMAGE';
                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: E_ModerationLogAction.DELETE,
                        type: mediaType as any, // Set type to IMAGE or VIDEO
                        userId: currentModerationMedia.result.uploadedById || currentUser.id,
                        moderationMediaId: id,
                        reason: reason || 'Rejected by moderator (manual rejection)',
                    },
                });
            }
            catch {
                // Log error but don't block - moderation log creation failure shouldn't prevent response
            }

            // Return the existing moderation media since it's already rejected
            return {
                success: true,
                message: 'ModerationMedia rejected (manual rejection log created).',
                result: currentModerationMedia.result,
            };
        }

        // If status is APPROVED, allow changing to REJECTED (override AI approval)
        // This allows moderators to reject even if AI has approved
        // Need to delete file in this case

        // Try delete underlying file on Bunny before status update (only if not already rejected)
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

        // Create DELETE log if it doesn't exist yet and update AI decision in existing logs
        if (moderationMediaUpdated.success && moderationMediaUpdated.result) {
            try {
                // Get all moderation logs for this media to update AI decision
                const allLogs = await moderationLogCtr.getModerationLogs(context, {
                    filter: {
                        moderationMediaId: id,
                    },
                    options: { pagination: false },
                });

                // Update AI decision in logs that have aiResult with PENDING decision
                if (allLogs.success && allLogs.result?.docs) {
                    for (const log of allLogs.result.docs) {
                        if (log.aiResult && log.aiResult.decision === E_ModerationMediaStatus.PENDING) {
                            // Update AI decision to REJECTED
                            await moderationLogCtr.updateModerationLog(context, {
                                filter: { id: log.id },
                                update: {
                                    aiResult: {
                                        ...log.aiResult,
                                        decision: E_ModerationMediaStatus.REJECTED,
                                    },
                                },
                            });
                        }
                    }
                }

                // Check if DELETE log exists
                const checkLogsAgain = await moderationLogCtr.getModerationLogs(context, {
                    filter: {
                        moderationMediaId: id,
                        action: E_ModerationLogAction.DELETE,
                    },
                    options: { pagination: false },
                });

                if (
                    !checkLogsAgain.success
                    || !checkLogsAgain.result?.docs
                    || checkLogsAgain.result.docs.length === 0
                ) {
                    // No DELETE log exists, create one
                    const mediaType = currentModerationMedia.result.type
                        ? (currentModerationMedia.result.type === E_ModerationMediaType.VIDEO ? E_ModerationLogType.VIDEO : E_ModerationLogType.IMAGE)
                        : E_ModerationLogType.IMAGE;
                    await moderationLogCtr.createModerationLog(context, {
                        doc: {
                            action: E_ModerationLogAction.DELETE,
                            type: mediaType, // Set type to IMAGE or VIDEO
                            userId: currentModerationMedia.result.uploadedById || currentUser.id,
                            moderationMediaId: id,
                            reason: reason || 'Rejected by moderator',
                        },
                    });
                }
            }
            catch {
                // Log error but don't block - moderation log creation failure shouldn't prevent response
                // The moderation media is already rejected, so this is just for audit trail
            }
        }

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
