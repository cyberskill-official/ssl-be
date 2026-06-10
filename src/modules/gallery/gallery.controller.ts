import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
    T_QueryFilter,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { isValidObjectId, Types } from 'mongoose';

import type { I_Location } from '#modules/location/location/location.type.js';
import type { I_User } from '#modules/user/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/authn.type.js';
import { authnCtr } from '#modules/authn/index.js';
import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role, E_Role_Staff } from '#modules/authz/role/role.type.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { E_LikeEntityType, likeCtr } from '#modules/like/index.js';
import { LocationModel } from '#modules/location/location/location.model.js';
import { E_LocationEntityType } from '#modules/location/location/location.type.js';
import { E_ModerationMediaStatus } from '#modules/moderation/moderation-media/moderation-media.type.js';
import { userCtr, UserModel } from '#modules/user/index.js';
import { getViewerMediaContext, hydrateUserMedia } from '#modules/user/user.validate.js';
import { viewCtr } from '#modules/view/index.js';
import { E_ViewEntityType } from '#modules/view/view.type.js';
import { getEnv } from '#shared/env/index.js';
import { queryCacheService } from '#shared/redis/query-cache.service.js';
import { getBlockedUserIds } from '#shared/util/index.js';
import { getRequestViewerMediaContext } from '#shared/util/viewer-media-context.helper.js';

import type {
    I_Gallery,
    I_Input_CreateGallery,
    I_Input_QueryDashboardGalleryInViewport,
    I_Input_QueryGallery,
    I_Input_QueryGalleryByUserId,
    I_Input_UpdateGallery,
} from './gallery.type.js';

import { GalleryModel } from './gallery.model.js';
import { E_GalleryType } from './gallery.type.js';
import { assertCanUploadVideo, isUploaderAgeVerified, notifyGalleryFollowersOnPublish, shouldSendPublishNotification } from './gallery.validate.js';

const env = getEnv();

const mongooseCtr = new MongooseController<I_Gallery>(GalleryModel);
const locationMongooseCtr = new MongooseController<I_Location>(LocationModel);

type CreateGalleryInput = I_Input_CreateOne<I_Input_CreateGallery> & {
    bypassAgeVerification?: boolean;
};

type GalleryPagingOptions = I_Input_FindPaging<I_Input_QueryGallery>['options'];
type UploaderAgeVerificationUser = Pick<I_User, 'ageVerify' | 'id' | 'roles'>;

const staffUploaderRoleNames = new Set<string>([
    ...Object.values(E_Role_Staff),
    E_Role.STAFF,
]);

function buildEmptyGalleryPage(page: number, limit: number): T_PaginateResult<I_Gallery> {
    return {
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
}

function hasSpecificGalleryFilter(
    filter?: T_QueryFilter<I_Input_QueryGallery>,
    options?: GalleryPagingOptions,
): boolean {
    const filterRecord = (filter || {}) as Record<string, unknown>;
    const optionsRecord = (options || {}) as Record<string, unknown>;
    const hasValue = (value: unknown): boolean => {
        if (Array.isArray(value))
            return value.length > 0;
        if (typeof value === 'string')
            return value.trim().length > 0;
        if (value && typeof value === 'object')
            return Object.keys(value).length > 0;
        return value !== undefined && value !== null;
    };

    const hasSearch
        = typeof optionsRecord['search'] === 'string'
            && optionsRecord['search'].trim().length > 0;

    return Boolean(
        hasValue(filterRecord['id'])
        || hasValue(filterRecord['_id'])
        || hasValue(filterRecord['moderationMediaId'])
        || hasValue(filterRecord['uploadedById'])
        || hasValue(filterRecord['uploadedByIds'])
        || hasSearch,
    );
}

function shouldGuardBroadGalleryQuery(
    filter?: T_QueryFilter<I_Input_QueryGallery>,
    options?: GalleryPagingOptions,
): boolean {
    return options?.pagination === false && !hasSpecificGalleryFilter(filter, options);
}

function isUploaderAgeVerifiedFromUser(
    uploader?: UploaderAgeVerificationUser | null,
): boolean {
    if (!uploader)
        return false;

    if (uploader.ageVerify?.status === E_AgeVerifyStatus.APPROVED)
        return true;

    return (uploader.roles || []).some(role =>
        role?.name ? staffUploaderRoleNames.has(role.name) : false,
    );
}

function hasPopulatedUploaderAgeVerification(
    uploader?: I_User | null,
): boolean {
    return Boolean(
        uploader
        && Object.hasOwn(uploader, 'ageVerify')
        && Array.isArray(uploader.roles),
    );
}

async function buildUploaderAgeVerificationCache(
    galleries: I_Gallery[],
): Promise<Map<string, boolean>> {
    const cache = new Map<string, boolean>();
    const uploaderIdsToFetch = new Set<string>();

    for (const gallery of galleries) {
        const uploaderId = gallery.uploadedBy?.id ?? gallery.uploadedById;
        if (!uploaderId || cache.has(uploaderId))
            continue;

        if (hasPopulatedUploaderAgeVerification(gallery.uploadedBy)) {
            cache.set(
                uploaderId,
                isUploaderAgeVerifiedFromUser(gallery.uploadedBy),
            );
            continue;
        }

        uploaderIdsToFetch.add(uploaderId);
    }

    const missingUploaderIds = Array.from(uploaderIdsToFetch).filter(
        uploaderId => !cache.has(uploaderId),
    );

    if (missingUploaderIds.length === 0)
        return cache;

    const uploaders = await UserModel.find({
        id: { $in: missingUploaderIds },
        isDel: { $ne: true },
        isAdminBlocked: { $ne: true },
    })
        .select({ ageVerify: 1, id: 1, rolesIds: 1 })
        .populate([{ path: 'roles', select: { id: 1, name: 1 } }])
        .lean<I_User[]>()
        .exec();

    const resolvedUploaderIds = new Set<string>();
    for (const uploader of uploaders) {
        if (!uploader.id)
            continue;

        resolvedUploaderIds.add(uploader.id);
        cache.set(uploader.id, isUploaderAgeVerifiedFromUser(uploader));
    }

    for (const uploaderId of missingUploaderIds) {
        if (!resolvedUploaderIds.has(uploaderId)) {
            cache.set(uploaderId, false);
        }
    }

    return cache;
}

async function attachUploaderLocationsToGalleries(galleries: I_Gallery[]) {
    const locationIds = Array.from(
        new Set(
            galleries.flatMap((gallery) => {
                const uploadedBy = gallery.uploadedBy;
                if (!uploadedBy) {
                    return [];
                }

                return [
                    uploadedBy.partner1?.locationId,
                    uploadedBy.partner2?.locationId,
                ].filter(
                    (locationId): locationId is string =>
                        typeof locationId === 'string' && locationId.trim().length > 0,
                );
            }),
        ),
    );

    if (!locationIds.length) {
        return;
    }

    const locationsResult = await locationMongooseCtr.findPaging(
        { id: { $in: locationIds } } as T_QueryFilter<I_Location>,
        {
            pagination: false,
            limit: locationIds.length,
            populate: [
                { path: 'country' },
                { path: 'city' },
            ],
        },
    );

    if (!locationsResult.success || !locationsResult.result) {
        return;
    }

    const locationById = new Map<string, I_Location>();
    for (const location of locationsResult.result.docs ?? []) {
        if (location?.id) {
            locationById.set(location.id, location);
        }
    }

    galleries.forEach((gallery) => {
        const uploadedBy = gallery.uploadedBy;
        if (!uploadedBy) {
            return;
        }

        if (uploadedBy.partner1?.locationId) {
            uploadedBy.partner1.location = locationById.get(uploadedBy.partner1.locationId);
        }

        if (uploadedBy.partner2?.locationId) {
            uploadedBy.partner2.location = locationById.get(uploadedBy.partner2.locationId);
        }
    });
}

async function attachUploaderProfileGalleriesToGalleries(galleries: I_Gallery[]) {
    const galleryIds = Array.from(
        new Set(
            galleries.flatMap((gallery) => {
                const uploadedBy = gallery.uploadedBy;
                if (!uploadedBy) {
                    return [];
                }

                return [
                    uploadedBy.partner1?.galleryId,
                    uploadedBy.partner2?.galleryId,
                ].filter(
                    (galleryId): galleryId is string =>
                        typeof galleryId === 'string' && galleryId.trim().length > 0,
                );
            }),
        ),
    );

    if (!galleryIds.length) {
        return;
    }

    const profileGalleries = await GalleryModel.find({
        id: { $in: galleryIds },
        isDel: { $ne: true },
    })
        .select({ id: 1, url: 1, thumbnailUrl: 1, type: 1, uploadedById: 1 })
        .lean<I_Gallery[]>()
        .exec();

    const galleryById = new Map<string, I_Gallery>();
    for (const gallery of profileGalleries) {
        if (gallery?.id) {
            galleryById.set(gallery.id, gallery);
        }
    }

    galleries.forEach((gallery) => {
        const uploadedBy = gallery.uploadedBy;
        if (!uploadedBy) {
            return;
        }

        if (uploadedBy.partner1?.galleryId) {
            uploadedBy.partner1.gallery = galleryById.get(uploadedBy.partner1.galleryId);
        }

        if (uploadedBy.partner2?.galleryId) {
            uploadedBy.partner2.gallery = galleryById.get(uploadedBy.partner2.galleryId);
        }
    });
}

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

        // Default to FREE for guests to avoid leaking clear images
        let isFreeMember = !isLoggedIn;
        let isPaidMember = false;

        if (isLoggedIn) {
            const viewerId = context.req?.session?.user?.id;
            try {
                // Fetch fresh user to avoid stale membership in session
                const viewerRes = viewerId
                    ? await userCtr.getUser(context, {
                            filter: { id: viewerId },
                            projection: 'id roles rolesIds membershipExpiresAt membershipEndDate',
                            populate: [{ path: 'roles' }],
                        })
                    : null;

                const mergedViewer = viewerRes?.success
                    ? { ...context.req?.session?.user, ...viewerRes.result }
                    : context.req?.session?.user;

                // Resolve paid/free role ids for robust detection (some sessions may lack populated roles)
                const [paidRole, promoRole, freeRole] = await Promise.all([
                    roleCtr.getRole(context, { filter: { name: 'PAID_MEMBER' } }),
                    roleCtr.getRole(context, { filter: { name: 'PROMO_MEMBER' } }),
                    roleCtr.getRole(context, { filter: { name: 'FREE_MEMBER' } }),
                ]);
                const paidRoleId = paidRole.success ? paidRole.result.id : undefined;
                const promoRoleId = promoRole.success ? promoRole.result.id : undefined;
                const freeRoleId = freeRole.success ? freeRole.result.id : undefined;

                const roles = Array.isArray(mergedViewer?.roles) ? mergedViewer.roles : [];
                const roleNames = roles
                    .map((r: any) => typeof r?.name === 'string' ? r.name.toUpperCase() : '')
                    .filter(Boolean);
                const roleIds = Array.isArray(mergedViewer?.rolesIds) ? mergedViewer.rolesIds : [];

                const hasFreeRole = roleNames.some(n => n.includes('FREE_MEMBER'))
                    || (freeRoleId ? roleIds.includes(freeRoleId) : false);
                const hasPaidRole = roleNames.some(n => n.includes('PAID_MEMBER') || n.includes('PROMO_MEMBER'))
                    || (paidRoleId ? roleIds.includes(paidRoleId) : false)
                    || (promoRoleId ? roleIds.includes(promoRoleId) : false);

                const membershipActive = mergedViewer ? authnCtr.isMembershipActive(mergedViewer) : false;

                isPaidMember = hasPaidRole && membershipActive;
                // Paid trumps free: if membership is active and user has PAID_MEMBER, do not treat as free even if FREE_MEMBER also present
                isFreeMember = isPaidMember ? false : (hasFreeRole || !membershipActive || (!isPaidMember && !hasPaidRole));
            }
            catch {
                // On any failure, treat as free to avoid leaking clear images
                isFreeMember = true;
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

        // Debug log removed to reduce noise

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

        if (!isStaff && !isAdmin && !isOwner && isHiddenStatus) {
            throwError({
                message: 'Gallery not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        // Check if uploader is age-verified
        const isUploaderVerified = await isUploaderAgeVerified(context, galleryFound.result);

        // If uploader is not age-verified: everyone (except staff/admin) sees blurred image
        const shouldBlurUploaderNotVerified = !isUploaderVerified && !isStaff && !isAdmin;

        // Free members: blur all galleries of others (not their own)
        // Paid members (membership active) can see clearly even if not age-verified
        // Note: Free members always see blurred galleries of others, regardless of age verification
        let shouldBlur = false;
        if (!isOwner && !shouldBlurUploaderNotVerified) {
            if (isPaidMember && !isFreeMember) {
                // Paid, active members see clear
                shouldBlur = false;
            }
            else if (isFreeMember) {
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
            // If uploader is not age-verified: always show blurred (to avoid swapping to a placeholder)
            if (shouldBlurUploaderNotVerified) {
                return bunnyCtr.generateBlurredUrl({
                    fullUrl: url,
                    extraQueryParams: { class: 'blur' },
                });
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
        }

        // Videos are always returned; frontend handles blur/visibility.
        if (galleryFound.result.type === E_GalleryType.VIDEO && galleryFound.result.url) {
            galleryFound.result.url = bunnyCtr.generateEmbedIframeUrlFromUrl({
                fullUrl: galleryFound.result.url,
            });
        }

        if (galleryFound.result.thumbnailUrl) {
            galleryFound.result.thumbnailUrl = applyThumbnailPolicy(galleryFound.result.thumbnailUrl) ?? galleryFound.result.thumbnailUrl;
        }
        else if (galleryFound.result.type === E_GalleryType.VIDEO && galleryFound.result.url) {
            const streamThumbnailUrl = bunnyCtr.generateStreamThumbnailUrlFromUrl({
                fullUrl: galleryFound.result.url,
            });
            if (streamThumbnailUrl) {
                galleryFound.result.thumbnailUrl = streamThumbnailUrl;
            }
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
            && (filter.uploadedByIds as string[]).some((id: string) => id && typeof id === 'string' && id.trim() === sessionUserId);
        const isOwner = ownerFromSingle || ownerFromMultiple;

        const fallbackViewerContext = getViewerMediaContext(
            isLoggedIn ? context.req?.session?.user : undefined,
        );
        let viewerMediaOptions = fallbackViewerContext.mediaOptions;
        let isFreeMember = !isLoggedIn || viewerMediaOptions.viewerIsFreeMember === true;
        let isPaidMember = viewerMediaOptions.viewerIsPaidMember === true;
        let isStaff = fallbackViewerContext.isStaff;
        let isAdmin = fallbackViewerContext.isAdmin;
        let viewerAgeVerified = viewerMediaOptions.viewerAgeVerified === true;

        if (isLoggedIn) {
            const viewerContext = await getRequestViewerMediaContext(context);
            viewerMediaOptions = viewerContext.mediaOptions;
            isStaff = viewerContext.isStaff;
            isAdmin = viewerContext.isAdmin;
            isPaidMember = viewerMediaOptions.viewerIsPaidMember === true;
            isFreeMember = viewerMediaOptions.viewerIsFreeMember === true;
            viewerAgeVerified = viewerMediaOptions.viewerAgeVerified === true;
        }

        // Apply filter + status
        let modifiedFilter = { ...(filter || {}) };
        if (filter?.uploadedByIds && (filter.uploadedByIds as string[]).length > 0) {
            modifiedFilter = {
                ...filter,
                uploadedById: { $in: filter.uploadedByIds as string[] },
            };
            delete modifiedFilter.uploadedByIds;
        }

        if (shouldGuardBroadGalleryQuery(modifiedFilter, options)) {
            return {
                success: true,
                message: 'No galleries found for broad unpaginated query.',
                result: buildEmptyGalleryPage(
                    Number(options?.page ?? 1),
                    Number(options?.limit ?? 0),
                ),
            };
        }

        const mongoFilter: Record<string, unknown> = { ...(modifiedFilter as Record<string, unknown>) };
        // Always hide deleted items
        mongoFilter['isDel'] = { $ne: true };
        // By default, hide REJECTED for everyone unless explicitly requested
        const hasExplicitStatus = filter?.status !== undefined;
        if (!hasExplicitStatus && mongoFilter['status'] === undefined) {
            mongoFilter['status'] = { $ne: E_ModerationMediaStatus.REJECTED };
        }
        // Only non-staff/admin/non-owner need isPublished; owner/staff/admin can see unpublished if explicitly filtered
        if (!isStaff && !isAdmin && !isOwner) {
            if (!hasExplicitStatus && mongoFilter['isPublished'] === undefined) {
                mongoFilter['isPublished'] = { $ne: false };
            }
        }

        // Debug log removed to reduce noise

        const uploaderPopulateMatch = (isStaff || isAdmin)
            ? undefined
            : (sessionUserId
                    ? {
                            $or: [
                                { registerStep: E_RegisterStep.COMPLETE },
                                { registerStep: { $exists: false } }, // treat legacy users as completed
                                { id: sessionUserId }, // owner can still see their own galleries
                            ],
                        }
                    : {
                            $or: [
                                { registerStep: E_RegisterStep.COMPLETE },
                                { registerStep: { $exists: false } }, // treat legacy users as completed
                            ],
                        });

        const galleries = await mongooseCtr.findPaging(mongoFilter, {
            ...options,
            populate: [
                {
                    path: 'uploadedBy',
                    match: uploaderPopulateMatch,
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

        await attachUploaderProfileGalleriesToGalleries(galleries.result.docs);

        const galleryDocs = (await Promise.all(
            galleries.result.docs.map(async (gallery) => {
                if (isStaff || isAdmin) {
                    return { gallery, shouldInclude: true };
                }

                const galleryStatus = gallery.status;
                const isOwner = sessionUserId && gallery.uploadedById === sessionUserId;
                const isApprovedOrPending
                    = galleryStatus === undefined
                        || galleryStatus === null
                        || galleryStatus === E_ModerationMediaStatus.APPROVED
                        || galleryStatus === E_ModerationMediaStatus.PENDING;
                const isRejected = galleryStatus === E_ModerationMediaStatus.REJECTED;

                if (isRejected) {
                    return { gallery, shouldInclude: false };
                }

                // Allow both PENDING and APPROVED images/videos to be shown to all users
                if (!isOwner && !isApprovedOrPending) {
                    return { gallery, shouldInclude: false };
                }

                // Only show galleries from users who completed registration (except owner/staff/admin)
                if (!isOwner) {
                    const uploader = (gallery as any)?.uploadedBy as { registerStep?: E_RegisterStep } | null | undefined;
                    // If populate match filtered out uploader, hide the gallery
                    if (!uploader) {
                        return { gallery, shouldInclude: false };
                    }
                    // Hide non-complete (legacy users may not have registerStep)
                    if (uploader.registerStep && uploader.registerStep !== E_RegisterStep.COMPLETE) {
                        return { gallery, shouldInclude: false };
                    }
                }

                // Strict filter removed to allow blurred galleries (isUploaderVerified will be checked later)

                if (!isOwner) {
                    // Free members (membership expired) can see galleries but they will be blurred or show default image
                    // Paid members (membership active) can see galleries even if not age-verified
                    // Non-verified viewers who are not paid members cannot see galleries of others
                    if (!viewerAgeVerified && !isPaidMember && !isFreeMember) {
                        return { gallery, shouldInclude: false }; // Hide all galleries from non-verified non-paid viewers (not free members)
                    }
                }

                return { gallery, shouldInclude: true };
            }),
        )).filter(({ shouldInclude }) => shouldInclude).map(({ gallery }) => gallery);
        const galleryIds = galleryDocs.map(g => g.id);
        const uploaderAgeVerificationCache = await buildUploaderAgeVerificationCache(galleryDocs);

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
            const isUploaderVerified = await isUploaderAgeVerified(context, gallery, uploaderAgeVerificationCache);

            // If uploader is not age-verified: everyone (except staff/admin) sees blurred image
            const shouldBlurUploaderNotVerified = !isUploaderVerified && !isStaff && !isAdmin;

            // Free members: blur all galleries of others (not their own)
            // Paid members (membership active) can see clearly even if not age-verified
            // Note: Free members always see blurred galleries of others, regardless of age verification
            let shouldBlur = false;
            if (!isGalleryOwner && !shouldBlurUploaderNotVerified) {
                if (isPaidMember && !isFreeMember) {
                    // Paid, active members see clear
                    shouldBlur = false;
                }
                else if (isFreeMember) {
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
                // If uploader is not age-verified: always show blurred (to avoid swapping to a placeholder)
                if (shouldBlurUploaderNotVerified) {
                    return bunnyCtr.generateBlurredUrl({
                        fullUrl: url,
                        extraQueryParams: { class: 'blur' },
                    });
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
            }
            // Videos are always returned; frontend handles blur/visibility.
            if (galleryResult.url && gallery.type === E_GalleryType.VIDEO) {
                galleryResult.url = bunnyCtr.generateEmbedIframeUrlFromUrl({
                    fullUrl: galleryResult.url,
                });
            }
            if (galleryResult.thumbnailUrl) {
                galleryResult.thumbnailUrl = transformMediaUrl(galleryResult.thumbnailUrl) ?? undefined;
            }
            else if (galleryResult.url && gallery.type === E_GalleryType.VIDEO) {
                const streamThumbnailUrl = bunnyCtr.generateStreamThumbnailUrlFromUrl({
                    fullUrl: galleryResult.url,
                });
                if (streamThumbnailUrl) {
                    galleryResult.thumbnailUrl = streamThumbnailUrl;
                }
            }

            // Hydrate uploadedBy user media (sign/blur profile images)
            if (galleryResult.uploadedBy) {
                hydrateUserMedia(galleryResult.uploadedBy, viewerMediaOptions);
            }

            return galleryResult;
        }));

        // Update totalDocs after filtering
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

    getDashboardGalleriesInViewport: async (
        context: I_Context,
        args: {
            filter: I_Input_QueryDashboardGalleryInViewport;
            options?: I_Input_FindPaging<I_Input_QueryGallery>;
        },
    ): Promise<I_Return<T_PaginateResult<I_Gallery>>> => {
        const { filter, options } = args;

        if (
            !filter
            || typeof filter.southWestLatitude !== 'number'
            || typeof filter.southWestLongitude !== 'number'
            || typeof filter.northEastLatitude !== 'number'
            || typeof filter.northEastLongitude !== 'number'
            || !filter.type
        ) {
            throwError({
                message: 'Filter (southWestLatitude, southWestLongitude, northEastLatitude, northEastLongitude, type) is required.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const pagingOptions = options ?? {};
        const { limit = 0, page = 1, sort: sortOptions } = pagingOptions as {
            limit?: number;
            page?: number;
            sort?: Record<string, unknown>;
        };

        const crossesAntimeridian = filter.southWestLongitude > filter.northEastLongitude;
        const locationFilter: T_QueryFilter<I_Location> = {
            'entityType': E_LocationEntityType.USER,
            'map.latitude': {
                $gte: filter.southWestLatitude,
                $lte: filter.northEastLatitude,
            },
            ...(crossesAntimeridian
                ? {
                        $or: [
                            { 'map.longitude': { $gte: filter.southWestLongitude } },
                            { 'map.longitude': { $lte: filter.northEastLongitude } },
                        ],
                    }
                : {
                        'map.longitude': {
                            $gte: filter.southWestLongitude,
                            $lte: filter.northEastLongitude,
                        },
                    }),
        };

        const viewportUserIdsResult = await locationMongooseCtr.distinct('entityId', locationFilter);
        if (!viewportUserIdsResult.success) {
            throwError({
                message: viewportUserIdsResult.message || 'Failed to load viewport users for dashboard galleries.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        const viewportUserIds = (viewportUserIdsResult.result ?? []).filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
        );

        if (!viewportUserIds.length) {
            return {
                success: true,
                message: 'No galleries found for provided viewport.',
                result: buildEmptyGalleryPage(page, limit),
            };
        }

        const galleriesResult = await galleryCtr.getGalleriesByUserIds(context, {
            filter: {
                userIds: viewportUserIds,
                type: filter.type,
                status: E_ModerationMediaStatus.APPROVED,
                isDel: false,
            },
            options: {
                ...pagingOptions,
                sort: { createdAt: -1, ...(sortOptions ?? {}) },
            } as I_Input_FindPaging<I_Input_QueryGallery>,
        });

        if (galleriesResult.success && galleriesResult.result?.docs?.length) {
            await attachUploaderLocationsToGalleries(galleriesResult.result.docs);
        }

        return galleriesResult;
    },

    createGallery: async (
        context: I_Context,
        { doc, bypassAgeVerification = false }: CreateGalleryInput,
    ): Promise<I_Return<I_Gallery>> => {
        // CRITICAL: Check age verification for ALL uploads (images + videos)
        // Only age-verified users can upload content to the platform
        // Avatar uploads can bypass this check.
        if (doc.uploadedById && !bypassAgeVerification) {
            const uploaderFound = await userCtr.getUser(context, {
                filter: { id: doc.uploadedById },
                populate: [{ path: 'ageVerify' }, { path: 'roles' }],
            });

            if (!uploaderFound.success) {
                throwError({
                    message: 'Uploader not found.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const isAgeVerified = uploaderFound.result?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;

            // Check if user is staff/admin (they are exempt from age verification)
            const roles = uploaderFound.result.roles ?? [];
            const roleNames = roles.map(role => role?.name).filter(Boolean) as string[];
            const staffRoleNames = [...Object.values(E_Role_Staff), E_Role.STAFF] as string[];
            const isStaffOrAdmin = roleNames.some(rn => staffRoleNames.includes(rn));

            if (!isAgeVerified && !isStaffOrAdmin) {
                throwError({
                    message: 'You must be age-verified to upload photos or videos. Please complete age verification in your profile settings.',
                    status: RESPONSE_STATUS.FORBIDDEN,
                });
            }
        }

        // Additional check for videos: free members cannot upload videos
        if (doc.type === E_GalleryType.VIDEO) {
            await assertCanUploadVideo(context, doc.uploadedById);
        }

        const galleryResult = await mongooseCtr.createOne(doc);

        if (galleryResult.success && shouldSendPublishNotification(galleryResult.result)) {
            await notifyGalleryFollowersOnPublish(context, galleryResult.result);
        }

        if (galleryResult.success) {
            await queryCacheService.bumpVersion('gallery');
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

        const result = await mongooseCtr.updateOne(filter, update, options);
        if (result.success) {
            await queryCacheService.bumpVersion('gallery');
        }
        return result;
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

        const result = await mongooseCtr.deleteOne(filter, options);
        if (result.success) {
            await queryCacheService.bumpVersion('gallery');
        }
        return result;
    },
    deleteGalleriesByUserId: async (
        context: I_Context,
        userId: string,
    ): Promise<void> => {
        if (!userId) {
            return;
        }

        const galleries = await mongooseCtr.findPaging(
            { $or: [{ uploadedById: userId }, { createdById: userId }] },
            { pagination: false },
        );

        if (!galleries.success || !galleries.result) {
            return;
        }

        for (const gallery of galleries.result.docs) {
            try {
                if (gallery.url) {
                    switch (gallery.type) {
                        case E_GalleryType.VIDEO: {
                            await bunnyCtr.deleteVideoUrl(context, gallery.url);
                            break;
                        }
                        case E_GalleryType.IMAGE: {
                            await bunnyCtr.deleteFile(
                                context,
                                gallery.url.replace(`${env.BUNNY_CDN_HOSTNAME}/`, ''),
                            );
                            break;
                        }
                        default:
                    }
                }
            }
            catch (error) {
                log.warn(`Failed to delete gallery asset ${gallery.id ?? 'unknown'}:`, error);
            }

            try {
                if (gallery.id) {
                    await mongooseCtr.deleteOne({ id: gallery.id });
                }
                else if ((gallery as { _id?: unknown })._id) {
                    await mongooseCtr.deleteOne({ _id: (gallery as { _id?: unknown })._id } as T_QueryFilter<I_Gallery>);
                }
            }
            catch (error) {
                log.warn(`Failed to delete gallery record ${gallery.id ?? 'unknown'}:`, error);
            }
        }
    },
    deleteOwnGallery: async (
        context: I_Context,
        { id }: { id: string },
    ): Promise<I_Return<I_Gallery>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        // Fetch directly to allow deleting even hidden (PENDING/REJECTED) galleries.
        let galleryFound = await mongooseCtr.findOne({ id, isDel: { $ne: true } });
        if (!galleryFound.success && isValidObjectId(id)) {
            galleryFound = await mongooseCtr.findOne({ _id: new Types.ObjectId(id), isDel: { $ne: true } } as any);
        }

        if (!galleryFound.success) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Gallery not found',
            });
        }

        const galleryId = typeof galleryFound.result.id === 'string' && galleryFound.result.id.trim()
            ? galleryFound.result.id.trim()
            : id.trim();

        if (galleryFound.result.uploadedById !== currentUser.id) {
            throwError({
                status: RESPONSE_STATUS.FORBIDDEN,
                message: 'You are not the owner of this gallery',
            });
        }

        const otherUserUsingGallery = await userCtr.getUser(context, {
            filter: {
                id: { $ne: currentUser.id },
                $or: [
                    { 'partner1.galleryId': galleryId },
                    { 'partner2.galleryId': galleryId },
                ],
            },
        });

        if (otherUserUsingGallery.success) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Cannot delete gallery: It is being used by a user partner.',
            });
        }

        // If the current user is using this gallery as their avatar, unlink it first.
        let partner1GalleryId = currentUser.partner1?.galleryId;
        let partner2GalleryId = currentUser.partner2?.galleryId;
        try {
            const currentUserFromDb = await userCtr.getUser(context, {
                filter: { id: currentUser.id },
                projection: { id: 1, partner1: 1, partner2: 1 } as any,
            });
            if (currentUserFromDb.success) {
                partner1GalleryId = currentUserFromDb.result.partner1?.galleryId ?? partner1GalleryId;
                partner2GalleryId = currentUserFromDb.result.partner2?.galleryId ?? partner2GalleryId;
            }
        }
        catch {
            // best-effort; fall back to session user fields
        }

        const setFields: Record<string, null> = {};
        if (partner1GalleryId === galleryId) {
            setFields['partner1.galleryId'] = null;
        }
        if (partner2GalleryId === galleryId) {
            setFields['partner2.galleryId'] = null;
        }
        if (Object.keys(setFields).length > 0) {
            await userCtr.updateUser(context, {
                filter: { id: currentUser.id },
                update: { $set: setFields } as any,
            });

            // Keep session in sync (best-effort).
            if (context?.req?.session?.user?.id === currentUser.id) {
                const sessionUser = context.req.session.user as any;
                if (setFields['partner1.galleryId'] !== undefined) {
                    sessionUser.partner1 = { ...(sessionUser.partner1 ?? {}), galleryId: null, gallery: null };
                }
                if (setFields['partner2.galleryId'] !== undefined) {
                    sessionUser.partner2 = { ...(sessionUser.partner2 ?? {}), galleryId: null, gallery: null };
                }
            }
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

        if (typeof galleryFound.result.id === 'string' && galleryFound.result.id.trim()) {
            const result = await mongooseCtr.deleteOne({ id: galleryFound.result.id.trim() });
            if (result.success) {
                await queryCacheService.bumpVersion('gallery');
            }
            return result;
        }
        const result = await mongooseCtr.deleteOne({ _id: galleryFound.result._id } as any);
        if (result.success) {
            await queryCacheService.bumpVersion('gallery');
        }
        return result;
    },
};
