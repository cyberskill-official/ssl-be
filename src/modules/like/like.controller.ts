import type {
    I_Input_CreateOne,
    I_Input_DeleteMany,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_DeleteResult,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Gallery } from '#modules/gallery/gallery.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { blogCtr } from '#modules/blog/index.js';
import { GalleryModel } from '#modules/gallery/gallery.model.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';
import { galleryCtr } from '#modules/gallery/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import {
    E_NotificationEntityType,
    E_NotificationType,
    E_RedirectType,
} from '#modules/notification/notification.type.js';
import { buildNotifThumbnail } from '#modules/notification/notification.util.js';

import type {
    I_Input_CreateLike,
    I_Input_GetLikeCountBatch,
    I_Input_QueryLike,
    I_Like,
} from './like.type.js';

import { LikeModel } from './like.model.js';
import { E_LikeEntityType } from './like.type.js';

const mongooseCtr = new MongooseController<I_Like>(LikeModel);
const galleryMongooseCtr = new MongooseController<I_Gallery>(GalleryModel);

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
        if (count.success)
            return count.result;
        return 0;
    },
    getLikeCountsBatch: async (
        _context: I_Context,
        { entityType, entityIds }: I_Input_GetLikeCountBatch,
    ): Promise<{ [entityId: string]: number }> => {
        const aggResult = await mongooseCtr.aggregate([
            { $match: { entityType, entityId: { $in: entityIds } } },
            { $group: { _id: '$entityId', count: { $sum: 1 } } },
        ]);

        const countsMap: { [entityId: string]: number } = {};
        if (!aggResult.success)
            return countsMap;
        if (aggResult.result) {
            for (const result of aggResult.result) {
                const { _id, count } = result as unknown as { _id: string; count: number };
                countsMap[_id] = count;
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
                // Use galleryExists instead of getGallery to avoid visibility restrictions
                // This allows liking galleries even if they're pending approval or uploader hasn't verified age
                let galleryExists = await galleryCtr.galleryExists(doc.entityId);

                // If gallery not found, check if it's stored in user's partner data (avatar gallery)
                if (!galleryExists) {
                    const { userCtr } = await import('#modules/user/index.js');

                    // Find user who has this gallery ID in partner1 or partner2
                    const userWithGallery = await userCtr.getUser(context, {
                        filter: {
                            $or: [
                                { 'partner1.galleryId': doc.entityId },
                                { 'partner2.galleryId': doc.entityId },
                            ],
                            isDel: { $ne: true },
                        },
                        projection: { 'id': 1, 'partner1.galleryId': 1, 'partner2.galleryId': 1 },
                    });

                    if (userWithGallery.success && userWithGallery.result) {
                        const user = userWithGallery.result;

                        // Check if current gallery IDs exist
                        const currentGalleryId1 = user.partner1?.galleryId;
                        const currentGalleryId2 = user.partner2?.galleryId;

                        // Use the gallery ID that matches or the first available one
                        if (currentGalleryId1 && await galleryCtr.galleryExists(currentGalleryId1)) {
                            doc.entityId = currentGalleryId1;
                            galleryExists = true;
                        }
                        else if (currentGalleryId2 && await galleryCtr.galleryExists(currentGalleryId2)) {
                            doc.entityId = currentGalleryId2;
                            galleryExists = true;
                        }
                    }
                }

                if (!galleryExists) {
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

        // 4) Notification (Gallery only)
        if (created.success && doc.entityType === E_LikeEntityType.GALLERY) {
            // Query gallery directly without visibility restrictions for notification
            // Don't use getGallery here as it has visibility restrictions that might fail
            const galleryInfo = await galleryMongooseCtr.findOne(
                { id: doc.entityId },
                { uploadedById: 1, type: 1, url: 1, thumbnailUrl: 1 },
                undefined,
                [{ path: 'uploadedBy', select: 'username' }],
            );
            if (galleryInfo.success && galleryInfo.result) {
                const ownerId = galleryInfo.result.uploadedById;

                if (ownerId && ownerId !== currentUser.id) {
                    const thumbnailUrl = buildNotifThumbnail(galleryInfo.result);
                    // Determine media type label for clearer UX
                    const mediaKind = galleryInfo.result.type === E_GalleryType.VIDEO ? 'video' : 'picture';
                    const headline = `liked your ${mediaKind}`;
                    const ownerUsername = (galleryInfo.result as I_Gallery & { uploadedBy?: { username?: string } })?.uploadedBy?.username;

                    await notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId: ownerId,
                            type: [E_NotificationType.MEDIA_LIKED],
                            entityType: E_NotificationEntityType.MEDIA,
                            entityId: doc.entityId,
                            actorId: currentUser.id,
                            presentation: {
                                // Redirect directly to the media (UI can still link actor profile via actorId)
                                redirect: { kind: E_RedirectType.MEDIA, id: doc.entityId },
                                ...(thumbnailUrl ? { thumbnailUrl } : {}),
                                actor: {
                                    username: currentUser.username,
                                    accountType: currentUser.accountType,
                                    avatarUrl: currentUser.partner1?.gallery?.url,
                                    gender: currentUser.partner1?.gender,
                                },
                                headline,
                                context: {
                                    mediaId: doc.entityId,
                                    mediaType: galleryInfo.result.type,
                                    galleryType: galleryInfo.result.type,
                                    isVideo: galleryInfo.result.type === E_GalleryType.VIDEO,
                                    profileOwnerId: ownerId,
                                    ...(ownerUsername ? { profileOwnerUsername: ownerUsername } : {}),
                                },
                            },
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

        return mongooseCtr.deleteOne(
            {
                userId: currentUser.id,
                ...filter,
            },
            options,
        );
    },
    deleteLikes: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteMany<I_Input_QueryLike>,
    ): Promise<I_Return<T_DeleteResult>> => {
        return mongooseCtr.deleteMany(filter, options);
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
            { $match: { userId, entityType, entityId: { $in: entityIds } } },
            { $group: { _id: '$entityId' } },
        ]);

        if (!result.success || !result.result) {
            return new Set();
        }

        return new Set((result.result as Array<{ _id: string }>).map(r => r._id));
    },
};
