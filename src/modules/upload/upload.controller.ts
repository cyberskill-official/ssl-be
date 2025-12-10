import type { I_Return } from '@cyberskill/shared/typescript';

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { E_UploadType, getAndValidateFile, getFileWebStream } from '@cyberskill/shared/node/upload';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { Readable } from 'node:stream';

import type {
    E_ModerationMediaStatus,
} from '#modules/moderation/index.js';
import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr, E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/index.js';
import { bunnyCtr, storageZone } from '#modules/bunny/index.js';
import { generateAndUploadThumbnail } from '#modules/gallery/thumbnail.util.js';
import { ipInfoCtr } from '#modules/ipInfo/ipinfo.controller.js';
import {
    aiModerationCtr,
    E_ModerationMediaType,
    moderationMediaCtr,
} from '#modules/moderation/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { E_ModerationLogAction, E_ModerationLogType } from '#modules/moderation/moderation-log/moderation-log.type.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';

import type {
    I_Input_Upload,
    I_Input_UploadContactAdmin,
    I_Result_ContactAdminUpload,
} from './upload.type.js';

import { UPLOAD_CONFIG } from './upload.constant.js';
import { applyAiModerationDecision, generateUploadPath } from './upload.util.js';

const env = getEnv();

export const uploadCtr = {
    upload: async (
        context: I_Context,
        args: I_Input_Upload,
    ): Promise<I_Return<{ url: string; moderationMediaId: string; status?: E_ModerationMediaStatus; entityId?: string; stubId?: string }>> => {
        const { type, entity, file, entityId, tagId, skipModeration, allowGuest } = args;
        const fileData = await getAndValidateFile(type, await file, UPLOAD_CONFIG);

        if (!fileData.success) {
            return fileData;
        }

        let currentUser: I_User;
        let isGuest = false;

        try {
            currentUser = await authnCtr.getUserFromSession(context);
        }
        catch (error) {
            if (!allowGuest) {
                throw error;
            }
            isGuest = true;
            const fallbackGuestId = entityId || `guest-${Date.now()}`;
            currentUser = {
                id: fallbackGuestId,
                registerStep: E_RegisterStep.COMPLETE,
                ageVerify: { status: E_AgeVerifyStatus.APPROVED },
                roles: [],
                rolesIds: [],
            } as unknown as I_User;
        }

        let isStaff = false;
        let isAdmin = false;
        let isFreeMember = false;

        if (!isGuest) {
            [isStaff, isAdmin, isFreeMember] = await Promise.all([
                authnCtr.isStaff(context),
                authnCtr.isAdmin(context),
                authnCtr.isFreeMember(context),
            ]);
        }

        // FREE_MEMBER can only upload images, not videos
        if (type === E_UploadType.VIDEO && isFreeMember && !isStaff && !isAdmin) {
            throwError({
                message: 'Free members can upload images only.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const isInRegistration = !isGuest && currentUser.registerStep !== E_RegisterStep.COMPLETE;
        const isGallery = entity === E_UploadEntity.GALLERY;

        // Age verification is required for all uploads (including FREE_MEMBER uploading images)
        // Exception: guest, staff, admin, or when skipModeration is true
        const requiresAgeVerification
            = !isGuest && !isStaff && !isAdmin && !skipModeration;

        if (requiresAgeVerification) {
            const isAgeApproved = currentUser?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            if (!isAgeApproved) {
                throwError({
                    status: RESPONSE_STATUS.FORBIDDEN,
                    message: 'Uploads require completed age verification. Please complete age verification before uploading.',
                });
            }
        }

        // Gallery uploads require paid membership (this is separate from FREE_MEMBER image uploads)
        const shouldGateUpload
            = !isGuest
                && !isStaff
                && !isAdmin
                && !skipModeration
                && !isInRegistration
                && isGallery;

        if (shouldGateUpload) {
            const isAgeApproved = currentUser?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            const isPaidMember = await authnCtr.isPaidMember(context);
            const membershipOk = authnCtr.isMembershipActive(currentUser);

            if (!(isAgeApproved && isPaidMember && membershipOk)) {
                throwError({
                    status: RESPONSE_STATUS.FORBIDDEN,
                    message: 'Uploads require active paid membership and completed age verification.',
                });
            }
        }

        const { filename, createReadStream } = fileData.result;

        const lastDotIndex = filename.lastIndexOf('.');

        if (lastDotIndex === -1) {
            throwError({
                message: 'Invalid file: no extension provided',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const extension = filename.substring(lastDotIndex);
        const nameWithoutExtension = filename.substring(0, lastDotIndex);
        const timestamp = new Date().getTime();
        const fullPath = `${nameWithoutExtension}-${timestamp}${extension}`;

        const resolvedEntityId = entityId ?? currentUser.id;

        const folderPath = generateUploadPath('', {
            type,
            entity,
            entityId: resolvedEntityId,
            userId: currentUser.id,
        });

        const uploadPath = path.posix.join(folderPath, fullPath);
        // Bypass moderation if:
        // - Admin/Staff
        // - Client explicitly requests skipModeration on this request
        const shouldBypassModeration = isStaff || isAdmin || !!skipModeration;

        if (shouldBypassModeration) {
            if (type === E_UploadType.VIDEO) {
                const videoUploaded = await bunnyCtr.uploadToBunnyStream(context, createReadStream(), uploadPath);

                if (!videoUploaded.success) {
                    return videoUploaded;
                }

                return {
                    success: true,
                    result: {
                        url: videoUploaded.result!,
                        moderationMediaId: '',
                        status: undefined,
                        entityId: resolvedEntityId,
                    },
                };
            }

            const directFileStream = await getFileWebStream(type, await file);

            if (!directFileStream.success) {
                return directFileStream;
            }

            await BunnyFile.upload(storageZone, `${uploadPath}`, directFileStream.result);

            const directUrl = `${env.BUNNY_CDN_HOSTNAME}/${uploadPath}`;

            return {
                message: 'Upload successful',
                success: true,
                result: {
                    url: directUrl,
                    moderationMediaId: '',
                    status: undefined,
                    entityId: resolvedEntityId,
                },
            };
        }

        if (type === E_UploadType.VIDEO) {
        // Read stream once → buffer
            const src = createReadStream();
            const bufChunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
                src.on('data', c => bufChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                src.on('end', () => resolve());
                src.on('error', reject);
            });
            const videoBuffer = Buffer.concat(bufChunks);

            const videoUploaded = await bunnyCtr.uploadToBunnyStream(context, Readable.from(videoBuffer), uploadPath);

            if (!videoUploaded.success) {
                return videoUploaded;
            }

            const myIpInfo = await ipInfoCtr.getMyIp();
            const clientIp = (myIpInfo?.result as any)?.ip as string | undefined;
            // Generate and upload thumbnail (best-effort)
            let thumbnailUrl: string | undefined;
            try {
                const thumbnailStoragePath = `${uploadPath}.thumbnail.jpg`;
                const thumbRes = await generateAndUploadThumbnail(context, videoBuffer, thumbnailStoragePath, 1);
                if (thumbRes.success) {
                    thumbnailUrl = thumbRes.result!;
                }
            }
            catch {
                // swallow thumbnail errors; not critical for upload
            }

            const moderationCreated = await moderationMediaCtr.createModerationMedia(context, {
                doc: {
                    type: E_ModerationMediaType.VIDEO,
                    uploadedById: currentUser.id,
                    url: videoUploaded.result!,
                    entity,
                    entityId: resolvedEntityId,
                    tagId,
                    ipAddress: clientIp,
                    thumbnailUrl,
                },
            });

            if (!moderationCreated.success) {
                throwError({
                    message: 'Failed to create moderation media.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            let finalVideoStatus = moderationCreated.result!.status;

            // Run AI after upload and record initial result to moderation_log
            try {
            // Pass the same bytes to AI moderation to ensure consistency
                const videoBytes = new Uint8Array(videoBuffer);
                const moderationResult = await aiModerationCtr.moderateVideo(context, { videoUrl: videoBytes });
                if (moderationResult.success && moderationCreated.success && moderationCreated.result?.id) {
                    const moderationId = moderationCreated.result.id;
                    const autoRejected = await applyAiModerationDecision(context, moderationId, moderationResult.result);

                    await moderationLogCtr.createModerationLog(context, {
                        doc: {
                            action: autoRejected ? E_ModerationLogAction.DELETE : E_ModerationLogAction.WARN,
                            type: E_ModerationLogType.VIDEO, // Set type to VIDEO for video uploads
                            userId: currentUser.id,
                            moderationMediaId: moderationId,
                            aiResult: moderationResult.result,
                        },
                    });

                    // Fetch updated status after AI moderation decision
                    const updatedModeration = await moderationMediaCtr.getModerationMedia(context, {
                        filter: { id: moderationId },
                    });
                    if (updatedModeration.success && updatedModeration.result) {
                        finalVideoStatus = updatedModeration.result.status;
                    }
                }
            }
            catch (error) {
                // Do not block upload on AI/log failure - log error but allow upload to succeed
                log.error('Failed to create AI moderation log (video)', {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    videoUrl: videoUploaded.result,
                    userId: currentUser.id,
                });
                // Continue without throwing - upload should succeed even if AI moderation fails
            }

            return {
                success: true,
                result: {
                    url: videoUploaded.result!,
                    moderationMediaId: moderationCreated.result!.id!,
                    status: finalVideoStatus,
                    entityId: moderationCreated.result!.entityId || resolvedEntityId,
                },
            };
        }

        // Get file stream for upload
        const fileWebStream = await getFileWebStream(type, await file);

        if (!fileWebStream.success) {
            return fileWebStream;
        }

        // Get file stream again for AI moderation (read file twice to avoid stream consumption issues)
        const moderationFileStream = await getFileWebStream(type, await file);

        if (!moderationFileStream.success) {
            return moderationFileStream;
        }

        // Convert Web Stream to buffer for AI moderation (avoid 404 from CDN)
        // Read from Web Stream using async iterator
        const bufChunks: Uint8Array[] = [];
        const reader = moderationFileStream.result.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value)
                    bufChunks.push(value);
            }
        }
        finally {
            reader.releaseLock();
        }

        // Combine all chunks into single buffer
        const totalLength = bufChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const imageBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of bufChunks) {
            imageBuffer.set(chunk, offset);
            offset += chunk.length;
        }

        // Ensure CDN hostname is set
        if (!env.BUNNY_CDN_HOSTNAME) {
            throwError({
                message: 'BUNNY_CDN_HOSTNAME is not configured',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const uploadedUrl = env.BUNNY_OPTIMIZER_BLUR_CLASS
            ? `${env.BUNNY_CDN_HOSTNAME}/${uploadPath}?class=${env.BUNNY_OPTIMIZER_BLUR_CLASS}`
            : `${env.BUNNY_CDN_HOSTNAME}/${uploadPath}`;

        // Validate URL was created
        if (!uploadedUrl || uploadedUrl.trim() === '') {
            throwError({
                message: 'Failed to generate upload URL',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        let clientIp: string | undefined;
        try {
            const userFound = await userCtr.getUser(context, {
                filter: { id: currentUser.id },
            });
            if (userFound.success && userFound.result.lastLoginIp) {
                clientIp = userFound.result.lastLoginIp;
            }
        }
        catch (error) {
            console.warn('Failed to get user IP from database:', error);
        }

        // Fallback to current IP if no user IP found
        if (!clientIp) {
            const myIpInfo = await ipInfoCtr.getMyIp();
            clientIp = (myIpInfo?.result as any)?.ip as string | undefined;
        }

        const moderationCreated = await moderationMediaCtr.createModerationMedia(context, {
            doc: {
                type: E_ModerationMediaType.IMAGE,
                uploadedById: currentUser.id,
                url: uploadedUrl,
                entity,
                entityId: resolvedEntityId,
                tagId,
                ipAddress: clientIp,
            },
        });

        if (!moderationCreated.success) {
            throwError({
                message: 'Failed to create moderation media.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        try {
            await BunnyFile.upload(storageZone, `${uploadPath}`, fileWebStream.result);
        }
        catch (uploadError) {
            log.error('Failed to upload file to Bunny CDN', {
                error: uploadError instanceof Error ? uploadError.message : String(uploadError),
                stack: uploadError instanceof Error ? uploadError.stack : undefined,
                uploadPath,
                userId: currentUser.id,
            });
            throwError({
                message: `Upload failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        let finalStatus = moderationCreated.result!.status;

        try {
            // Use image buffer directly for AI moderation to avoid CDN 404 issues
            const moderateImage = await aiModerationCtr.moderateImage(context, { imageUrl: imageBuffer });

            if (moderateImage.success && moderationCreated.success && moderationCreated.result?.id) {
                const moderationId = moderationCreated.result.id;
                const autoRejected = await applyAiModerationDecision(context, moderationId, moderateImage.result);

                // Always create moderation log regardless of rejection status
                try {
                    // Get moderation media to determine type (IMAGE or VIDEO)
                    const moderationMedia = await moderationMediaCtr.getModerationMedia(context, {
                        filter: { id: moderationId },
                    });
                    const mediaType = moderationMedia.success && moderationMedia.result?.type
                        ? (moderationMedia.result.type === E_ModerationMediaType.VIDEO ? E_ModerationLogType.VIDEO : E_ModerationLogType.IMAGE)
                        : E_ModerationLogType.IMAGE;

                    await moderationLogCtr.createModerationLog(context, {
                        doc: {
                            action: autoRejected ? E_ModerationLogAction.DELETE : E_ModerationLogAction.WARN,
                            type: mediaType, // Set type to IMAGE or VIDEO
                            userId: currentUser.id,
                            moderationMediaId: moderationId,
                            aiResult: moderateImage.result,
                        },
                    });
                }
                catch (logError) {
                    // Log error but don't block - moderation log creation failure shouldn't prevent response
                    log.error('Failed to create moderation log', {
                        error: logError instanceof Error ? logError.message : String(logError),
                        moderationId,
                        userId: currentUser.id,
                    });
                }

                // Fetch updated status after AI moderation decision
                const updatedModeration = await moderationMediaCtr.getModerationMedia(context, {
                    filter: { id: moderationId },
                });
                if (updatedModeration.success && updatedModeration.result) {
                    finalStatus = updatedModeration.result.status;
                }
            }
        }
        catch (error) {
            // Do not block upload on AI/log failure - log error but allow upload to succeed
            log.error('Failed to create AI moderation log on upload', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                uploadedUrl,
                userId: currentUser.id,
            });
            // Continue without throwing - upload should succeed even if AI moderation fails
        }

        return {
            message: 'Upload successful',
            success: true,
            result: {
                url: uploadedUrl,
                moderationMediaId: moderationCreated.result!.id!,
                status: finalStatus,
                entityId: moderationCreated.result!.entityId || resolvedEntityId,
            },
        };
    },
    uploadContactAdmin: async (
        context: I_Context,
        args: I_Input_UploadContactAdmin,
    ): Promise<I_Return<I_Result_ContactAdminUpload>> => {
        const trimmedStub = args.stubId?.trim() ?? '';
        const stubId = trimmedStub || `guest-${Date.now()}`;
        const skipModeration = args.skipModeration ?? true;
        const uploadResponse = await uploadCtr.upload(context, {
            type: E_UploadType.IMAGE,
            entity: E_UploadEntity.CONVERSATION,
            entityId: stubId,
            tagId: 'contact-admin',
            skipModeration,
            allowGuest: true,
            file: args.file,
        });

        if (!uploadResponse.success || !uploadResponse.result) {
            return uploadResponse as I_Return<I_Result_ContactAdminUpload>;
        }

        return {
            success: true,
            message: uploadResponse.message,
            result: {
                url: uploadResponse.result.url,
                stubId,
                entityId: uploadResponse.result.entityId ?? stubId,
            },
        };
    },
};
