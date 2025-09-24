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
import { bunnyCtr } from '#modules/bunny/index.js';
import { followCtr } from '#modules/follow/index.js';
import { E_LikeEntityType, likeCtr } from '#modules/like/index.js';
import { buildNotifThumbnail } from '#modules/notification/index.js';
import { notificationCtr } from '#modules/notification/notification.controller.js';
import { E_NotificationEntityType, E_NotificationType, E_RedicrectType } from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';
import { viewCtr } from '#modules/view/index.js';
import { E_ViewEntityType } from '#modules/view/view.type.js';
import { getEnv } from '#shared/env/index.js';

import type {
    I_Gallery,
    I_Input_CreateGallery,
    I_Input_QueryGallery,
    I_Input_QueryGalleryByUserId,
    I_Input_UpdateGallery,
} from './gallery.type.js';

import { GalleryModel } from './gallery.model.js';
import { E_GalleryType } from './gallery.type.js';

const env = getEnv();

const mongooseCtr = new MongooseController<I_Gallery>(GalleryModel);

export const galleryCtr = {
    getGallery: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        const isLoggedIn = !!context?.req?.session?.user;
        let isFreeMember = false;

        if (isLoggedIn) {
            try {
                isFreeMember = await authnCtr.isFreeMember(context);
            }
            catch {
                isFreeMember = true;
            }
        }

        const galleryFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!galleryFound.success) {
            return galleryFound;
        }
        if (galleryFound.result.url && galleryFound.result.type === E_GalleryType.IMAGE) {
            galleryFound.result.url = bunnyCtr.generateSignedUrl({
                fullUrl: galleryFound.result.url,
                extraQueryParams: {
                    class: isFreeMember ? 'free' : 'premium',
                },
            });
        }

        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getGalleries: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryGallery>,
    ): Promise<I_Return<T_PaginateResult<I_Gallery>>> => {
        const isLoggedIn = !!context?.req?.session?.user;
        const userId = context.req?.session?.user?.id;
        const isOwner = context.req?.session?.user?.id === filter?.uploadedById;

        let isFreeMember = false;
        if (isLoggedIn) {
            try {
                isFreeMember = await authnCtr.isFreeMember(context);
            }
            catch {
                isFreeMember = true;
            }
        }

        // ép filter + status
        let modifiedFilter = { ...(filter || {}) };
        if (filter?.uploadedByIds && filter.uploadedByIds.length > 0) {
            modifiedFilter = {
                ...filter,
                uploadedById: { $in: filter.uploadedByIds },
            };
            delete modifiedFilter.uploadedByIds;
        }

        const galleries = await mongooseCtr.findPaging(modifiedFilter, {
            ...options,
            populate: [
                {
                    path: 'uploadedBy',
                },
            ],
        });

        if (!galleries.success) {
            return galleries;
        }

        const galleryDocs = galleries.result.docs;
        const galleryIds = galleryDocs.map(g => g.id);

        // batch like/view
        const likeCountsMap = await likeCtr.getLikeCountsBatch(context, {
            entityType: E_LikeEntityType.GALLERY,
            entityIds: galleryIds,
        });
        const viewCountsMap = await viewCtr.getViewCountsBatch(context, {
            entityType: E_ViewEntityType.GALLERY,
            entityIds: galleryIds,
        });

        let userLikesSet: Set<string> = new Set();
        if (isLoggedIn) {
            userLikesSet = await likeCtr.getUserLikesBatch(context, {
                userId: userId || '',
                entityType: E_LikeEntityType.GALLERY,
                entityIds: galleryIds,
            });
        }

        galleries.result.docs = galleryDocs.map((gallery) => {
            const isLike = isLoggedIn && userLikesSet.has(gallery.id);
            const likeCount = likeCountsMap[gallery.id] || 0;
            const viewCount = viewCountsMap[gallery.id] || 0;

            const galleryResult = { ...gallery, isLike, likeCount, viewCount };

            if (galleryResult.url && gallery.type === E_GalleryType.IMAGE) {
                galleryResult.url = bunnyCtr.generateSignedUrl({
                    fullUrl: galleryResult.url,
                    extraQueryParams: {
                        class: isOwner ? 'normal' : (isFreeMember ? 'free' : 'premium'),
                    },
                });
            }
            if (galleryResult.url && gallery.type === E_GalleryType.VIDEO) {
                galleryResult.url = bunnyCtr.generateEmbedIframeUrlFromUrl({
                    fullUrl: galleryResult.url,
                });
            }

            return galleryResult;
        });

        return galleries;
    },
    getGalleriesByUserIds: async (
        context: I_Context,
        { filter, options }: {
            filter: I_Input_QueryGalleryByUserId;
            options?: I_Input_FindPaging<I_Input_QueryGallery>;
        },
    ): Promise<I_Return<T_PaginateResult<I_Gallery>>> => {
        const { userIds, ...galleryFilter } = filter;

        // B1: validate user
        const userFound = await userCtr.getUsers(context, {
            filter: { id: { $in: userIds }, isActive: true },
        });

        if (!userFound.success) {
            throwError({
                message: 'User not found!',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // B2: list uploadedByIds
        const uploadedByIds = userFound.result.docs.map(u => u.id);

        // B3: query gallery
        return galleryCtr.getGalleries(context, {
            filter: { ...galleryFilter, uploadedByIds },
            options: {
                ...options,
                sort: { createdAt: -1 },
            },
        });
    },

    createGallery: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        const galleryResult = await mongooseCtr.createOne(doc);

        if (galleryResult.success) {
            const uploaderId = galleryResult.result.uploadedById;

            // 1) Thumbnail poster cho notification (ký URL, không iframe)
            const thumbnailUrl = buildNotifThumbnail(galleryResult.result);

            // 2) Notify followers (IN_APP luôn có, EMAIL theo toggle — handled by WithSettings)
            try {
                const followers = await followCtr.getFollowers(_context, {
                    filter: { followId: uploaderId },
                    options: { pagination: false },
                });

                const uploaderFound = await userCtr.getUser(_context, { filter: { id: uploaderId } });

                if (!uploaderFound.success) {
                    return galleryResult;
                }

                const { displayName = '', username = '' } = uploaderFound.result;
                const uploaderName = (displayName || username);

                if (followers.success) {
                    for (const f of followers.result.docs) {
                        const targetId = f.userId;
                        if (!targetId || targetId === uploaderId)
                            continue;

                        await notificationCtr.createNotificationWithSettings(_context, {
                            doc: {
                                targetId,
                                type: E_NotificationType.FOLLOWED_PROFILE_POSTED_MEDIA,
                                entityType: E_NotificationEntityType.MEDIA,
                                entityId: galleryResult.result.id,
                                actorId: uploaderId,
                                title: `${uploaderName} has posted a new ${galleryResult.result.type?.toLowerCase() ?? 'media'}`,
                                presentation: {
                                    redirect: { kind: E_RedicrectType.MEDIA, id: galleryResult.result.id },
                                    ...(thumbnailUrl ? { thumbnailUrl } : {}),
                                },
                            },
                        });
                    }
                }
            }
            catch {
            }
        }

        return galleryResult;
    },

    updateGallery: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        if (update.url) {
            const existingGallery = await galleryCtr.getGallery(context, { filter });

            if (existingGallery.success && existingGallery.result.url && existingGallery.result.url !== update.url) {
                switch (existingGallery.result.type) {
                    case E_GalleryType.VIDEO: {
                        await bunnyCtr.deleteVideoUrl(context, existingGallery.result.url);
                        break;
                    }
                    case E_GalleryType.IMAGE: {
                        await bunnyCtr.deleteFile(context, existingGallery.result.url.replace(`${env.BUNNY_CDN_HOSTNAME}/`, ''));
                        break;
                    }
                    default:
                }
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteGallery: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        const galleryFound = await galleryCtr.getGallery(context, {
            filter,
        });

        if (!galleryFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Gallery not found',
            });
        }

        if (galleryFound.result.url) {
            switch (galleryFound.result.type) {
                case E_GalleryType.VIDEO: {
                    await bunnyCtr.deleteVideoUrl(context, galleryFound.result.url);
                    break;
                }
                case E_GalleryType.IMAGE: {
                    await bunnyCtr.deleteFile(context, galleryFound.result.url.replace(`${env.BUNNY_CDN_HOSTNAME}/`, ''));
                    break;
                }
                default:
            }
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    deleteOwnGallery: async (
        context: I_Context,
        { id }: { id: string },
    ): Promise<I_Return<I_Gallery>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const galleryFound = await galleryCtr.getGallery(context, {
            filter: { id },
        });

        if (!galleryFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Gallery not found',
            });
        }

        if (galleryFound.result.uploadedById !== currentUser.id) {
            throwError({
                status: RESPONSE_STATUS.FORBIDDEN,
                message: 'You are not the owner of this gallery',
            });
        }

        const userUsingGallery = await userCtr.getUser(context, {
            filter: {
                $or: [
                    { 'partner1.galleryId': id },
                    { 'partner2.galleryId': id },
                ],
            },
        });

        if (userUsingGallery.success) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Cannot delete gallery: It is being used by a user partner.',
            });
        }

        if (galleryFound.result.url) {
            switch (galleryFound.result.type) {
                case E_GalleryType.VIDEO: {
                    await bunnyCtr.deleteVideoUrl(context, galleryFound.result.url);
                    break;
                }
                case E_GalleryType.IMAGE: {
                    await bunnyCtr.deleteFile(context, galleryFound.result.url.replace(`${env.BUNNY_CDN_HOSTNAME}/`, ''));
                    break;
                }
                default:
            }
        }

        return mongooseCtr.deleteOne({ id });
    },
};
