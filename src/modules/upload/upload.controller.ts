import type { I_Return } from '@cyberskill/shared/typescript';

import { file as BunnyFile } from '@bunny.net/storage-sdk';
import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { E_UploadType, getAndValidateFile, getFileWebStream } from '@cyberskill/shared/node/upload';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { E_ModerationMediaStatus } from '#modules/moderation/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { bunnyCtr, storageZone } from '#modules/bunny/index.js';
import { ipInfoCtr } from '#modules/ipInfo/ipinfo.controller.js';
import { aiModerationCtr, E_ModerationMediaType, moderationMediaCtr } from '#modules/moderation/index.js';
import { moderationLogCtr } from '#modules/moderation/moderation-log/moderation-log.controller.js';
import { E_ModerationLogAction } from '#modules/moderation/moderation-log/moderation-log.type.js';
import { getEnv } from '#shared/env/index.js';

import type { I_Input_Upload } from './upload.type.js';

import { UPLOAD_CONFIG } from './upload.constant.js';
import { generateUploadPath } from './upload.util.js';

const env = getEnv();

export const uploadCtr = {
    upload: async (context: I_Context, args: I_Input_Upload): Promise<I_Return<{ url: string; moderationMediaId: string; status?: E_ModerationMediaStatus; entityId?: string }>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const { type, entity, file, entityId, tagId, skipModeration } = args;
        const fileData = await getAndValidateFile(type, await file, UPLOAD_CONFIG);

        if (!fileData.success) {
            return fileData;
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

        const folderPath = generateUploadPath('', {
            type,
            entity,
            entityId,
            userId: currentUser.id,
        });

        const uploadPath = path.posix.join(folderPath, fullPath);

        const isStaff = await authnCtr.isStaff(context);
        const shouldBypassModeration = isStaff || !!skipModeration;

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
                        entityId,
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
                    entityId,
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
                    entityId,
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
                    // Always log first
                    await moderationLogCtr.createModerationLog(context, {
                        doc: {
                            action: E_ModerationLogAction.WARN,
                            userId: currentUser.id,
                            moderationMediaId: moderationId,
                            aiResult: moderationResult.result,
                        },
                    });

                    // Auto-reject disabled; keep PENDING and only log reasons
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
                    entityId: moderationCreated.result!.entityId || entityId,
                },
            };
        }

        const fileWebStream = await getFileWebStream(type, await file);

        if (!fileWebStream.success) {
            return fileWebStream;
        }

        const uploadedUrl = `${env.BUNNY_CDN_HOSTNAME}/${uploadPath}`;

        const myIpInfo = await ipInfoCtr.getMyIp();
        const clientIp = (myIpInfo?.result as any)?.ip as string | undefined;

        const moderationCreated = await moderationMediaCtr.createModerationMedia(context, {
            doc: {
                type: E_ModerationMediaType.IMAGE,
                uploadedById: currentUser.id,
                url: uploadedUrl,
                entity,
                entityId,
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

                await moderationLogCtr.createModerationLog(context, {
                    doc: {
                        action: E_ModerationLogAction.WARN,
                        userId: currentUser.id,
                        moderationMediaId: moderationId,
                        aiResult: moderateImage.result,
                    },
                });

                // Auto-reject disabled; keep PENDING and only log reasons
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
                entityId: moderationCreated.result!.entityId || entityId,
            },
        };
    },
};
