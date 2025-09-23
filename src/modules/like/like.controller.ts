import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { blogCtr } from '#modules/blog/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { galleryCtr } from '#modules/gallery/index.js';
import { notificationCtr } from '#modules/notification/notification.controller.js';
import { E_NotificationChannel, E_NotificationEntityType, E_NotificationType } from '#modules/notification/notification.type.js';

import type { I_Input_CreateLike, I_Input_GetLikeCountBatch, I_Input_QueryLike, I_Like } from './like.type.js';

import { LikeModel } from './like.model.js';
import { E_LikeEntityType } from './like.type.js';

const mongooseCtr = new MongooseController<I_Like>(LikeModel);

export const likeCtr = {
    getLike: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryLike>,
    ): Promise<I_Return<I_Like>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getLikes: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryLike>,
    ): Promise<I_Return<T_PaginateResult<I_Like>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    getLikeCount: async (
        _context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryLike>,
    ): Promise<number> => {
        const count = await mongooseCtr.count(filter);
        if (count.success) {
            return count.result;
        }
        return 0;
    },
    getLikeCountsBatch: async (
        _context: I_Context,
        { entityType, entityIds }: I_Input_GetLikeCountBatch,
    ): Promise<{ [entityId: string]: number }> => {
        const aggResult = await mongooseCtr.aggregate([
            {
                $match: {
                    entityType,
                    entityId: { $in: entityIds },
                },
            },
            {
                $group: {
                    _id: '$entityId',
                    count: { $sum: 1 },
                },
            },
        ]);

        const countsMap: { [entityId: string]: number } = {};
        if (!aggResult.success) {
            return countsMap;
        }
        if (aggResult.result) {
            for (const result of aggResult.result) {
                const { _id, count } = result as unknown as { _id: string; count: number };
                countsMap[_id] = count; // count
            }
        }
        return countsMap;
    },
    createLike: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateLike>,
    ): Promise<I_Return<I_Like>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        // 1) Validate entity
        switch (doc.entityType) {
            case E_LikeEntityType.GALLERY: {
                const entityFound = await galleryCtr.getGallery(context, {
                    filter: { id: doc.entityId },
                });
                if (!entityFound.success) {
                    throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'Gallery not found' });
                }
                break;
            }
            case E_LikeEntityType.BLOG: {
                const entityFound = await blogCtr.getBlog(context, { filter: { id: doc.entityId } });
                if (!entityFound.success) {
                    throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'Blog not found' });
                }
                break;
            }
            default:
                throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Invalid entityType' });
        }

        // 2) Prevent duplicate like
        const likeFound = await likeCtr.getLike(context, {
            filter: {
                userId: currentUser.id,
                entityType: doc.entityType,
                entityId: doc.entityId,
            },
        });
        if (likeFound.success) {
            throwError({ message: 'Like already exists.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // 3) Create like
        const created = await mongooseCtr.createOne({ ...doc, userId: currentUser.id });

        // 4) Notification (Gallery only, bell-only)
        // ...
        if (created.success && doc.entityType === E_LikeEntityType.GALLERY) {
            const galleryFound = await galleryCtr.getGallery(context, { filter: { id: doc.entityId } });
            if (galleryFound.success) {
                const ownerId = galleryFound.result.uploadedById;

                if (ownerId && ownerId !== currentUser.id) {
                    // generate thumbnailUrl if possible
                    let thumbnailUrl: string | undefined;
                    try {
                        if (galleryFound.result.url) {
                            if (galleryFound.result.type === 'IMAGE') {
                                thumbnailUrl = bunnyCtr.generateSignedUrl({ fullUrl: galleryFound.result.url, extraQueryParams: { class: 'normal' } });
                            }
                            else if (galleryFound.result.type === 'VIDEO') {
                                thumbnailUrl = bunnyCtr.generateEmbedIframeUrlFromUrl({ fullUrl: galleryFound.result.url });
                            }
                        }
                    }
                    catch {
                        // ignore thumbnail generation errors
                    }

                    await notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: ownerId,
                            type: E_NotificationType.MEDIA_LIKED,
                            entityType: E_NotificationEntityType.MEDIA,
                            entityId: doc.entityId,
                            actorId: currentUser.id,
                            title: `${currentUser.displayName || currentUser.username} liked your ${galleryFound.result.type?.toLowerCase() ?? 'media'}`,
                            data: {
                                galleryId: doc.entityId,
                                galleryType: galleryFound.result.type,
                                ...(thumbnailUrl ? { thumbnailUrl } : {}),
                                redirect: { kind: 'PROFILE', id: currentUser.id },
                            },
                            channels: [E_NotificationChannel.IN_APP],
                            isEmailSuppressed: true,
                        },
                    });
                }
            }
        }

        return created;
    },
    deleteLike: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryLike>,
    ): Promise<I_Return<I_Like>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const likeFound = await likeCtr.getLike(context, {
            filter: {
                userId: currentUser.id,
                ...filter,
            },
        });

        if (!likeFound.success) {
            throwError({
                message: 'Like not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne({
            userId: currentUser.id,
            ...filter,
        }, options);
    },
    getUserLikesBatch: async (
        _context: I_Context,
        input: { userId: string; entityType: E_LikeEntityType; entityIds: string[] },
    ): Promise<Set<string>> => {
        const { userId, entityType, entityIds } = input;

        if (!userId || !entityType || !entityIds || entityIds.length === 0) {
            return new Set();
        }

        const result = await mongooseCtr.aggregate([
            {
                $match: {
                    userId,
                    entityType,
                    entityId: { $in: entityIds },
                },
            },
            {
                $group: {
                    _id: '$entityId',
                },
            },
        ]);

        if (!result.success || !result.result) {
            return new Set();
        }

        return new Set(
            (result.result as Array<{ _id: string }>).map(r => r._id),
        );
    },
};
