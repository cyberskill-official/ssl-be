import type { I_Return } from '@cyberskill/shared/typescript';

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
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
import { ipInfoCtr } from '#modules/ipInfo/ipinfo.controller.js';
import {
    aiModerationCtr,
    E_ModerationMediaType,
    moderationMediaCtr,
} from '#modules/moderation/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { E_ModerationLogAction } from '#modules/moderation/moderation-log/moderation-log.type.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';

import type { I_Input_Upload } from './upload.type.js';

import { UPLOAD_CONFIG } from './upload.constant.js';
import { applyAiModerationDecision, generateUploadPath } from './upload.util.js';

const env = getEnv();

export const uploadCtr = {
    upload: async (context: I_Context, args: I_Input_Upload): Promise<I_Return<{ url: string; moderationMediaId: string; status?: E_ModerationMediaStatus; entityId?: string }>> => {
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
            currentUser = {
                id: `guest-${Date.now()}`,
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

        if (type === E_UploadType.VIDEO && isFreeMember && !isStaff && !isAdmin) {
            throwError({
                message: 'Free members can upload images only.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const isInRegistration = !isGuest && currentUser.registerStep !== E_RegisterStep.COMPLETE;
        const isGallery
            = entity === E_UploadEntity.GALLERY;

        const shouldGateUpload
            = !isGuest
                && !isStaff
                && !isAdmin
                && !skipModeration
                && !isInRegistration
                && isGallery;

        const requiresAgeVerification
            = !isGuest && !isStaff && !isAdmin && !skipModeration;

        if (requiresAgeVerification) {
            const isAgeApproved = currentUser?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            if (!isAgeApproved) {
                throwError({
                    status: RESPONSE_STATUS.FORBIDDEN,
                    message: 'Uploads require completed age verification.',
                });
            }
        }

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
        const shouldBypassModeration = isStaff || !!skipModeration || isAdmin;

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
            const moderationCreated = await moderationMediaCtr.createModerationMedia(context, {
                doc: {
                    type: E_ModerationMediaType.VIDEO,
                    uploadedById: currentUser.id,
                    url: videoUploaded.result!,
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
                            userId: currentUser.id,
                            moderationMediaId: moderationId,
                            aiResult: moderationResult.result,
                        },
                    });
                }
            }
            catch (error) {
                throwError({
                    message: `Failed to create AI moderation log (video): ${(error as Error)?.message || String(error)}`,
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            return {
                success: true,
                result: {
                    url: videoUploaded.result!,
                    moderationMediaId: moderationCreated.result!.id!,
                    status: moderationCreated.result!.status,
                    entityId: moderationCreated.result!.entityId || resolvedEntityId,
                },
            };
        }

        const fileWebStream = await getFileWebStream(type, await file);

        if (!fileWebStream.success) {
            return fileWebStream;
        }

        const uploadedUrl = env.BUNNY_OPTIMIZER_BLUR_CLASS
            ? `${env.BUNNY_CDN_HOSTNAME}/${uploadPath}?class=${env.BUNNY_OPTIMIZER_BLUR_CLASS}`
            : `${env.BUNNY_CDN_HOSTNAME}/${uploadPath}`;

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

        await BunnyFile.upload(storageZone, `${uploadPath}`, fileWebStream.result);

        try {
            const moderateImage = await aiModerationCtr.moderateImage(context, { imageUrl: uploadedUrl });

            if (moderateImage.success && moderationCreated.success && moderationCreated.result?.id) {
                const moderationId = moderationCreated.result.id;
                const autoRejected = await applyAiModerationDecision(context, moderationId, moderateImage.result);

                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: autoRejected ? E_ModerationLogAction.DELETE : E_ModerationLogAction.WARN,
                        userId: currentUser.id,
                        moderationMediaId: moderationId,
                        aiResult: moderateImage.result,
                    },
                });
            }
        }
        catch (error) {
            // Do not block upload on AI/log failure
            throwError({
                message: `Failed to create AI moderation log on upload: ${(error as Error)?.message || String(error)}`,
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        return {
            message: 'Upload successful',
            success: true,
            result: {
                url: uploadedUrl,
                moderationMediaId: moderationCreated.result!.id!,
                status: moderationCreated.result!.status,
                entityId: moderationCreated.result!.entityId || resolvedEntityId,
            },
        };
    },
};
