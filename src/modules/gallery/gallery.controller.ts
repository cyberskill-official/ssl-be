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

import { E_AgeVerifyStatus } from '#modules/authn/authn.type.js';
import { authnCtr } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { E_LikeEntityType, likeCtr } from '#modules/like/index.js';
import { E_ModerationMediaStatus } from '#modules/moderation/moderation-media/moderation-media.type.js';
import { userCtr } from '#modules/user/index.js';
import { viewCtr } from '#modules/view/index.js';
import { E_ViewEntityType } from '#modules/view/view.type.js';
import { getEnv } from '#shared/env/index.js';
import { getBlockedUserIds } from '#shared/util/index.js';

import type {
    I_Gallery,
    I_Input_CreateGallery,
    I_Input_QueryGallery,
    I_Input_QueryGalleryByUserId,
    I_Input_UpdateGallery,
} from './gallery.type.js';

import { GalleryModel } from './gallery.model.js';
import { E_GalleryType } from './gallery.type.js';
import { assertCanUploadVideo, isUploaderAgeVerified, notifyGalleryFollowersOnPublish, shouldSendPublishNotification } from './gallery.validate.js';

const env = getEnv();

const mongooseCtr = new MongooseController<I_Gallery>(GalleryModel);

export const galleryCtr = {
    /**
     * Check if gallery exists in database without visibility restrictions
     * Used for validation purposes (e.g., when creating likes)
     * Only checks if gallery exists and is not deleted, regardless of status, isPublished, or age verification
     */
    galleryExists: async (galleryId: string): Promise<boolean> => {
        const { isValidObjectId, Types } = await import('mongoose');

        // Try to find by id (UUID) first
        let result = await mongooseCtr.findOne(
            { id: galleryId, isDel: { $ne: true } },
            undefined,
            undefined,
            undefined,
        );

        // If not found and galleryId is a valid ObjectId, try finding by _id
        if (!result.success && isValidObjectId(galleryId)) {
            result = await mongooseCtr.findOne(
                { _id: new Types.ObjectId(galleryId), isDel: { $ne: true } },
                undefined,
                undefined,
                undefined,
            );
        }

        return result.success && !!result.result;
    },
    getGallery: async (
        context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        const isLoggedIn = !!context?.req?.session?.user;
        let isFreeMember = false;
        let isPaidMember = false;

        if (isLoggedIn) {
            try {
                isFreeMember = await authnCtr.isFreeMember(context);
            }
            catch {
                isFreeMember = true;
            }

            try {
                isPaidMember = await authnCtr.isPaidMember(context);
            }
            catch {
                isPaidMember = false;
            }
        }

        // Safety: if we cannot determine membership and user is not staff/admin, default to FREE to avoid leaking clear images
        if (!isPaidMember && !isFreeMember) {
            isFreeMember = true;
        }

        let viewerAgeVerified = false;
        if (isLoggedIn) {
            try {
                const viewer = await authnCtr.getUserFromSession(context);
                viewerAgeVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            }
            catch {
                viewerAgeVerified = false;
            }
        }

        const galleryFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!galleryFound.success) {
            return galleryFound;
        }

        const currentUserId = context?.req?.session?.user?.id;
        const isOwner = currentUserId && galleryFound.result.uploadedById === currentUserId;
        let isStaff = false;
        let isAdmin = false;

        if (isLoggedIn) {
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
        }

        // Safety: if membership state is unknown and user is not staff/admin, default to FREE to ensure blur
        if (!isPaidMember && !isFreeMember && !isStaff && !isAdmin) {
            isFreeMember = true;
        }

        if (!isOwner && !isStaff && !isAdmin && !shouldSendPublishNotification(galleryFound.result)) {
            throwError({
                message: 'Gallery not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const galleryStatus = galleryFound.result.status;
        const isHiddenStatus
            = galleryStatus !== undefined
                && galleryStatus !== null
                && galleryStatus !== E_ModerationMediaStatus.APPROVED;

        if (!isStaff && !isAdmin && isHiddenStatus) {
            throwError({
                message: 'Gallery not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        // Check if uploader is age-verified
        // If uploader is not age-verified and viewer is not owner/staff/admin, show default image (null)
        const isUploaderVerified = await isUploaderAgeVerified(context, galleryFound.result);
        const shouldShowDefaultImage = !isUploaderVerified && !isOwner && !isStaff && !isAdmin;

        // Free members: blur all galleries of others (not their own)
        // Paid members (membership active) can see clearly even if not age-verified
        // Note: Free members always see blurred galleries of others, regardless of age verification
        let shouldBlur = false;
        if (!isOwner && !shouldShowDefaultImage) {
            if (isFreeMember) {
                // Free members always see blurred galleries of others
                shouldBlur = true;
            }
            else if (!viewerAgeVerified && !isPaidMember && !isStaff && !isAdmin) {
                // Non-verified non-paid members see blurred galleries
                shouldBlur = true;
            }
        }
        const membershipClass = isOwner ? 'normal' : (isFreeMember ? 'free' : 'premium');

        const applyThumbnailPolicy = (url?: string | null) => {
            if (!url)
                return url;
            // If uploader is not age-verified, return null to show default image
            if (shouldShowDefaultImage) {
                return null;
            }
            if (shouldBlur) {
                return bunnyCtr.generateBlurredUrl({
                    fullUrl: url,
                    extraQueryParams: { class: 'blur' },
                });
            }
            return bunnyCtr.generateSignedUrl({
                fullUrl: url,
                extraQueryParams: membershipClass ? { class: membershipClass } : undefined,
            });
        };

        // Transform image URL: set to null/undefined if uploader is not age-verified (to show default image)
        if (galleryFound.result.type === E_GalleryType.IMAGE) {
            if (galleryFound.result.url) {
                galleryFound.result.url = applyThumbnailPolicy(galleryFound.result.url) ?? undefined;
            }
            // If shouldShowDefaultImage is true, explicitly set url to undefined even if it exists
            if (shouldShowDefaultImage) {
                galleryFound.result.url = undefined;
            }
        }

        // Video access control: paid members (membership active) can view videos even if not age-verified
        // Hide video completely for unauthorized users
        if (galleryFound.result.type === E_GalleryType.VIDEO) {
            const canViewVideo = isOwner || isStaff || isAdmin || (isPaidMember && !isFreeMember) || (viewerAgeVerified && !isFreeMember);
            if (!canViewVideo) {
                // Hide video completely - return not found
                throwError({
                    message: 'Gallery not found',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }
            // Generate embed URL for authorized users
            if (galleryFound.result.url) {
                galleryFound.result.url = bunnyCtr.generateEmbedIframeUrlFromUrl({
                    fullUrl: galleryFound.result.url,
                });
            }
        }

        if (galleryFound.result.thumbnailUrl) {
            galleryFound.result.thumbnailUrl = applyThumbnailPolicy(galleryFound.result.thumbnailUrl) ?? galleryFound.result.thumbnailUrl;
        }

        return galleryFound;
    },
    getGalleries: async (
        context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryGallery>,
    ): Promise<I_Return<T_PaginateResult<I_Gallery>>> => {
        const isLoggedIn = !!context?.req?.session?.user;
        const userId = context.req?.session?.user?.id;
        const sessionUserId = context.req?.session?.user?.id;
        const ownerFromSingle = sessionUserId === filter?.uploadedById;
        const ownerFromMultiple = Array.isArray(filter?.uploadedByIds)
            && filter.uploadedByIds.some(id => id && typeof id === 'string' && id.trim() === sessionUserId);
        const isOwner = ownerFromSingle || ownerFromMultiple;

        let isFreeMember = false;
        let isPaidMember = false;
        let isStaff = false;
        let isAdmin = false;
        if (isLoggedIn) {
            try {
                isFreeMember = await authnCtr.isFreeMember(context);
            }
            catch {
                isFreeMember = true;
            }

            try {
                isPaidMember = await authnCtr.isPaidMember(context);
            }
            catch {
                isPaidMember = false;
            }

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

        const mongoFilter: Record<string, unknown> = { ...(modifiedFilter as Record<string, unknown>) };

        if (!isStaff && !isAdmin && !isOwner) {
            const hasExplicitStatus = filter?.status !== undefined;
            if (mongoFilter['status'] === undefined) {
                mongoFilter['status'] = { $in: [E_ModerationMediaStatus.APPROVED, null] };
            }
            // Only add isPublished filter when user hasn't explicitly provided status filter
            // This allows logged-in users to query by status without being restricted by isPublished
            if (!hasExplicitStatus && mongoFilter['isPublished'] === undefined) {
                mongoFilter['isPublished'] = { $ne: false };
            }
        }

        let viewerAgeVerified = false;
        if (isLoggedIn) {
            try {
                const viewer = await authnCtr.getUserFromSession(context);
                viewerAgeVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            }
            catch {
                viewerAgeVerified = false;
            }
        }

        const galleries = await mongooseCtr.findPaging(mongoFilter, {
            ...options,
            populate: [
                {
                    path: 'uploadedBy',
                    populate: [
                        { path: 'ageVerify' },
                        { path: 'roles' },
                    ],
                },
            ],
        });

        if (!galleries.success) {
            return galleries;
        }

        // Check uploader age verification status for all galleries
        const uploaderAgeVerificationCache = new Map<string, boolean>();

        const galleryDocs = (await Promise.all(
            galleries.result.docs.map(async (gallery) => {
                if (isStaff || isAdmin) {
                    return { gallery, shouldInclude: true };
                }

                const galleryStatus = gallery.status;
                const isApproved
                    = galleryStatus === undefined
                        || galleryStatus === null
                        || galleryStatus === E_ModerationMediaStatus.APPROVED;

                if (!isApproved) {
                    return { gallery, shouldInclude: false };
                }

                // Hide galleries from non-age-verified uploaders (except owner viewing their own)
                const isOwner = sessionUserId && gallery.uploadedById === sessionUserId;
                if (!isOwner) {
                    // Free members (membership expired) can see galleries but they will be blurred or show default image
                    // Don't filter out galleries - they will show default image (null URL) or be blurred in the transform step
                    // Paid members (membership active) can see galleries even if not age-verified
                    // Non-verified viewers who are not paid members cannot see galleries of others
                    if (!viewerAgeVerified && !isPaidMember && !isFreeMember) {
                        return { gallery, shouldInclude: false }; // Hide all galleries from non-verified non-paid viewers (not free members)
                    }
                    // Don't filter out galleries from non-age-verified uploaders - they will show default image (null URL) in transform step
                }

                // Hide videos completely for users who are not age-verified paid members (or owner)
                // Paid members (membership active) can view videos even if not age-verified
                if (gallery.type === E_GalleryType.VIDEO) {
                    const canViewVideo = isOwner || (isPaidMember && !isFreeMember) || (viewerAgeVerified && !isFreeMember);
                    if (!canViewVideo) {
                        return { gallery, shouldInclude: false }; // Filter out video from results
                    }
                }

                return { gallery, shouldInclude: true };
            }),
        )).filter(({ shouldInclude }) => shouldInclude).map(({ gallery }) => gallery);
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

        galleries.result.docs = await Promise.all(galleryDocs.map(async (gallery) => {
            const isLike = isLoggedIn && userLikesSet.has(gallery.id);
            const likeCount = likeCountsMap[gallery.id] || 0;
            const viewCount = viewCountsMap[gallery.id] || 0;

            const galleryResult = { ...gallery, isLike, likeCount, viewCount };

            const isGalleryOwner = sessionUserId && gallery.uploadedById === sessionUserId;
            const membershipClass = isGalleryOwner
                ? 'normal'
                : (isFreeMember ? 'free' : 'premium');

            // Check if uploader is age-verified
            // If uploader is not age-verified and viewer is not owner/staff/admin, show default image (null)
            const isUploaderVerified = await isUploaderAgeVerified(context, gallery, uploaderAgeVerificationCache);
            const shouldShowDefaultImage = !isUploaderVerified && !isGalleryOwner && !isStaff && !isAdmin;

            // Free members: blur all galleries of others (not their own)
            // Paid members (membership active) can see clearly even if not age-verified
            // Note: Free members always see blurred galleries of others, regardless of age verification
            let shouldBlur = false;
            if (!isGalleryOwner && !shouldShowDefaultImage) {
                if (isFreeMember) {
                    // Free members always see blurred galleries of others
                    shouldBlur = true;
                }
                else if (!viewerAgeVerified && !isPaidMember && !isStaff && !isAdmin) {
                    // Non-verified non-paid members see blurred galleries
                    shouldBlur = true;
                }
            }
            const transformMediaUrl = (url?: string | null) => {
                if (!url)
                    return url;
                // If uploader is not age-verified, return null to show default image
                if (shouldShowDefaultImage) {
                    return null;
                }
                if (shouldBlur) {
                    return bunnyCtr.generateBlurredUrl({
                        fullUrl: url,
                        extraQueryParams: { class: 'blur' },
                    });
                }
                return bunnyCtr.generateSignedUrl({
                    fullUrl: url,
                    extraQueryParams: membershipClass ? { class: membershipClass } : undefined,
                });
            };

            // Transform image URL: set to null/undefined if uploader is not age-verified (to show default image)
            if (gallery.type === E_GalleryType.IMAGE) {
                if (galleryResult.url) {
                    galleryResult.url = transformMediaUrl(galleryResult.url) ?? undefined;
                }
                // If shouldShowDefaultImage is true, explicitly set url to undefined even if it exists
                if (shouldShowDefaultImage) {
                    galleryResult.url = undefined;
                }
            }
            // Video access control: only age-verified paid members (or owner/staff/admin) can view videos
            // Videos are already filtered out above, so we only process videos for authorized users here
            if (galleryResult.url && gallery.type === E_GalleryType.VIDEO) {
                galleryResult.url = bunnyCtr.generateEmbedIframeUrlFromUrl({
                    fullUrl: galleryResult.url,
                });
            }
            if (galleryResult.thumbnailUrl) {
                galleryResult.thumbnailUrl = transformMediaUrl(galleryResult.thumbnailUrl) ?? undefined;
            }

            return galleryResult;
        }));

        // Update totalDocs after filtering out videos
        const currentPage = galleries.result.page || 1;
        galleries.result.totalDocs = galleryDocs.length;
        galleries.result.totalPages = Math.ceil(galleryDocs.length / (galleries.result.limit || 1));
        galleries.result.hasNextPage = currentPage < galleries.result.totalPages;
        galleries.result.hasPrevPage = currentPage > 1;

        return galleries;
    },
    getGalleriesByUserIds: async (
        context: I_Context,
        args: {
            filter?: I_Input_QueryGalleryByUserId;
            options?: I_Input_FindPaging<I_Input_QueryGallery>;
        } = {},
    ): Promise<I_Return<T_PaginateResult<I_Gallery>>> => {
        const { filter = {}, options } = args;
        const pagingOptions = options ?? {};
        const { limit = 0, page = 1, sort: sortOptions } = pagingOptions as { limit?: number; page?: number; sort?: Record<string, unknown> };
        const { userIds = [], ...galleryFilter } = filter;

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return galleryCtr.getGalleries(context, { filter: galleryFilter, options });
        }

        // Get blocked user IDs for bidirectional blocking
        const blockedUserIds = await getBlockedUserIds(context);

        // Filter out blocked users from the requested userIds
        let uploadedByIds = userIds.filter(id => typeof id === 'string' && id.trim().length > 0);
        if (blockedUserIds.size > 0) {
            uploadedByIds = uploadedByIds.filter(userId => !blockedUserIds.has(userId));
        }

        if (!uploadedByIds.length) {
            const emptyResult: T_PaginateResult<I_Gallery> = {
                docs: [],
                totalDocs: 0,
                limit,
                totalPages: 0,
                page,
                pagingCounter: 0,
                hasPrevPage: false,
                hasNextPage: false,
                prevPage: null,
                nextPage: null,
                offset: 0,
            };

            return { success: true, message: 'No galleries found for provided users.', result: emptyResult };
        }

        return galleryCtr.getGalleries(context, {
            filter: { ...galleryFilter, uploadedByIds },
            options: {
                ...pagingOptions,
                limit,
                page,
                sort: { createdAt: -1, ...(sortOptions ?? {}) },
            },
        });
    },

    createGallery: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        if (doc.type === E_GalleryType.VIDEO) {
            await assertCanUploadVideo(context, doc.uploadedById);
        }

        const galleryResult = await mongooseCtr.createOne(doc);

        if (galleryResult.success && shouldSendPublishNotification(galleryResult.result)) {
            await notifyGalleryFollowersOnPublish(context, galleryResult.result);
        }

        return galleryResult;
    },

    updateGallery: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateGallery>,
    ): Promise<I_Return<I_Gallery>> => {
        if (update.type === E_GalleryType.VIDEO) {
            const existingGallery = await galleryCtr.getGallery(context, { filter });

            if (!existingGallery.success) {
                throwError({
                    message: existingGallery.message ?? 'Gallery not found',
                    status: existingGallery.message ? RESPONSE_STATUS.BAD_REQUEST : RESPONSE_STATUS.NOT_FOUND,
                });
            }

            const uploaderId = existingGallery.result.uploadedById ?? update.uploadedById;
            await assertCanUploadVideo(context, uploaderId);
        }

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
    notifyGalleryPublished: async (context: I_Context, galleryId: string): Promise<void> => {
        const galleryFound = await mongooseCtr.findOne({ id: galleryId });

        if (!galleryFound.success || !galleryFound.result) {
            return;
        }

        if (shouldSendPublishNotification(galleryFound.result)) {
            await notifyGalleryFollowersOnPublish(context, galleryFound.result);
        }
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
