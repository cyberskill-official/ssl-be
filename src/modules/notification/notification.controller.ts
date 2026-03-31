import type { I_Input_CreateOne, I_Input_DeleteMany, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_DeleteResult, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { withFilter } from 'graphql-subscriptions';
import mongoose, { isValidObjectId, Types } from 'mongoose';

import type { I_Context, I_WsContext } from '#shared/typescript/index.js';

import { AGE_VERIFICATION_SKIPPED, NEW_ANNOUNCEMENT_FOLLOWED_OR_NEARBY, NEW_FOLLOWER, NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST, NEW_MESSAGE, PAYMENT_FAILED } from '#modules/authn/authn.constant.js';
import { authnCtr, E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/index.js';
import { E_Role, E_Role_Staff } from '#modules/authz/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { emailCtr } from '#modules/email/index.js';
import { eventCtr } from '#modules/event/event.controller.js';
import { followCtr } from '#modules/follow/index.js';
import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import { userCtr } from '#modules/user/index.js';
import { pubsub } from '#shared/graphql/pubsub.js';
import { getBlockedUserIds } from '#shared/util/index.js';

import type {
    I_Input_CreateNotification,
    I_Input_QueryNotification,
    I_Input_UpdateNotification,
    I_Notification,
    I_NotificationAddedPayload,
    I_NotificationDeletedPayload,
    I_NotificationDismissedPayload,
    I_NotificationPresentation,
    I_NotificationReadPayload,
    I_NotificationUpdatedPayload,
} from './notification.type.js';

import { ALLOW_INCOMPLETE_PROFILE_TYPES, buildMediaLikedLink, sendMediaLikedEmail } from './notification.handler.js';
import { NotificationModel } from './notification.model.js';
import {
    E_NOTIFICATION_EVENTS,
    E_NotificationChannel,
    E_NotificationEntityType,
    E_NotificationStatus,
    E_NotificationType,
    OTHER_TYPES,
} from './notification.type.js';
import { hasInApp, isValidMap } from './notification.util.js';

const mongooseCtr = new MongooseController<I_Notification>(NotificationModel);

export const notificationCtr = {
    getNotification: async (
        _context: I_Context,
        { filter, projection, options }: I_Input_FindOne<I_Input_QueryNotification>,
    ): Promise<I_Return<I_Notification>> => {
        return mongooseCtr.findOne(filter, projection, options);
    },
    countOtherUnreadInApp: async (_context: I_Context, userId: string): Promise<number> => {
        const res = await mongooseCtr.count({
            targetId: userId,
            channels: { $in: [E_NotificationChannel.IN_APP] },
            type: { $ne: E_NotificationType.NEW_MESSAGE },
            status: { $ne: E_NotificationStatus.READ },
            dismissedAt: null,
        });
        return res.success ? res.result : 0;
    },

    countConversationUnreadInApp: async (_context: I_Context, userId: string): Promise<number> => {
        const res = await mongooseCtr.count({
            targetId: userId,
            channels: { $in: [E_NotificationChannel.IN_APP] },
            entityType: E_NotificationEntityType.CONVERSATION,
            type: E_NotificationType.NEW_MESSAGE,
            status: { $ne: E_NotificationStatus.READ },
            dismissedAt: null,
        });
        return res.success ? res.result : 0;
    },

    getNotificationCounters: async (context: I_Context) => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const userId = currentUser.id;

        if (!userId) {
            return { numberOfConversationUnRead: 0, numberOfOtherUnRead: 0 };
        }

        const [numberOfOtherUnRead, numberOfConversationUnRead] = await Promise.all([
            notificationCtr.countOtherUnreadInApp(context, userId),
            // Count notifications with entityType CONVERSATION instead of message status
            // This ensures group chat notifications are included
            notificationCtr.countConversationUnreadInApp(context, userId),
        ]);

        return { numberOfConversationUnRead, numberOfOtherUnRead };
    },
    getNotifications: async (
        _context: I_Context,
        { filter = {}, options }: I_Input_FindPaging<I_Input_QueryNotification>,
    ): Promise<I_Return<T_PaginateResult<I_Notification>>> => {
        const f = { ...filter };

        // Chuẩn hoá channels: mảng -> $in
        if (Array.isArray(f.channels)) {
            f.channels = { $in: f.channels };
        }

        const inputType = f.type;
        delete f.type;

        const emptyResult: T_PaginateResult<I_Notification> = {
            docs: [],
            totalDocs: 0,
            limit: options?.limit ?? 0,
            totalPages: 0,
            page: options?.page ?? 1,
            pagingCounter: 0,
            hasPrevPage: false,
            hasNextPage: false,
            prevPage: null,
            nextPage: null,
            offset: 0,
        };

        if (inputType === undefined) {
            // Mặc định: chỉ OTHER_TYPES
            f.type = { $in: OTHER_TYPES };
        }
        else if (Array.isArray(inputType)) {
            // Client truyền mảng -> tôn trọng nguyên si
            if (inputType.length === 0) {
                return { success: true, message: '', result: emptyResult };
            }
            f.type = { $in: inputType };
        }
        else {
            // String
            if (inputType === E_NotificationType.NEW_MESSAGE) {
                f.type = E_NotificationType.NEW_MESSAGE;
            }
            else if (typeof inputType === 'string' && OTHER_TYPES.includes(inputType as E_NotificationType)) {
                f.type = inputType as E_NotificationType;
            }
            else {
                // Loại không hợp lệ theo rule -> rỗng
                return { success: true, message: 'OK', result: emptyResult };
            }
        }

        const opts = {
            sort: { createdAt: -1 },
            ...options,
        };

        const res = await mongooseCtr.findPaging(f, opts);

        // Check if entities still exist and auto-dismiss notifications for deleted entities
        if (res.success && res.result && Array.isArray(res.result.docs)) {
            const notificationsToDismiss: string[] = [];

            for (const n of res.result.docs) {
                // Skip if already dismissed
                if (n.dismissedAt || n.status === E_NotificationStatus.DISMISSED) {
                    continue;
                }

                // Check if entity (especially USER) still exists
                if (n.entityType === E_NotificationEntityType.USER && n.entityId) {
                    try {
                        const entityUser = await userCtr.getUser(_context, { filter: { id: n.entityId } });
                        // If user is explicitly confirmed as deleted, dismiss notification
                        if (entityUser.success && entityUser.result?.isDel === true) {
                            notificationsToDismiss.push(n.id!);
                        }
                    }
                    catch {
                        // Ignore check failures to avoid accidental dismissal
                    }
                }
            }

            // Auto-dismiss notifications for deleted entities
            if (notificationsToDismiss.length > 0) {
                try {
                    await mongooseCtr.updateMany(
                        { id: { $in: notificationsToDismiss } },
                        { status: E_NotificationStatus.DISMISSED, dismissedAt: new Date() },
                    );
                    // Remove dismissed notifications from result
                    res.result.docs = res.result.docs.filter(n => !notificationsToDismiss.includes(n.id!));
                    res.result.totalDocs = res.result.docs.length;
                }
                catch {
                    // non-fatal: if dismiss fails, continue with original result
                }
            }
        }

        // Enrich presentation media (avatar, thumbnails) according to actor's and owner's age verification status
        try {
            let viewerIsStaff = false;
            let viewerIsAdmin = false;
            let viewerId: string | undefined;
            let sessionViewer: any;
            try {
                sessionViewer = await authnCtr.getUserFromSession(_context);
                viewerId = sessionViewer?.id;
                const roles = Array.isArray(sessionViewer?.roles) ? sessionViewer?.roles : [];
                viewerIsAdmin = roles.some((role: any) =>
                    role.name === E_Role_Staff.ADMIN
                    || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes(E_Role_Staff.ADMIN)),
                );
                viewerIsStaff = roles.some((role: any) =>
                    role.name === E_Role.STAFF
                    || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes(E_Role.STAFF)),
                );
            }
            catch {
                // Viewer not authenticated or error getting viewer
            }

            const viewerExempt = viewerIsStaff || viewerIsAdmin;

            // Check viewer's membership status
            let viewerIsFreeMember = false;
            let viewerIsPaidMember = false;
            if (viewerId) {
                try {
                    const viewerResult = await userCtr.getUsers(_context, {
                        filter: { id: viewerId },
                        options: { pagination: false },
                        populate: [{ path: 'roles' }],
                    } as any);
                    if (viewerResult.success && viewerResult.result?.docs?.[0]) {
                        const viewer = viewerResult.result.docs[0];
                        const viewerRoles = Array.isArray(viewer.roles) ? viewer.roles : [];

                        // Support legacy/variant role names and case-insensitive matching
                        const hasRole = (names: string[]) => viewerRoles.some(
                            (role: any) => typeof role?.name === 'string'
                                && names.some(n => role.name.toLowerCase() === n.toLowerCase()),
                        );

                        const viewerHasFreeRole = hasRole(['FREE_MEMBER', 'FREE_MEM']);
                        const viewerHasPaidRole = hasRole(['PAID_MEMBER', 'PAID_MEM', 'PROMO_MEMBER']);
                        const viewerMembershipActive = authnCtr.isMembershipActive(viewer);
                        viewerIsFreeMember = viewerHasFreeRole || (viewerHasPaidRole && !viewerMembershipActive);
                        viewerIsPaidMember = viewerHasPaidRole && viewerMembershipActive;
                    }
                }
                catch {
                    // Fallback handled below
                }
            }

            // Fallback: use session viewer roles if DB fetch fails or returns empty
            if (!viewerIsFreeMember && !viewerIsPaidMember) {
                const fallbackRoles = Array.isArray(sessionViewer?.roles) ? sessionViewer.roles : [];
                const hasRole = (names: string[]) => fallbackRoles.some(
                    (role: any) => typeof role?.name === 'string'
                        && names.some(n => role.name.toLowerCase() === n.toLowerCase()),
                );
                const viewerHasFreeRole = hasRole(['FREE_MEMBER', 'FREE_MEM']);
                const viewerHasPaidRole = hasRole(['PAID_MEMBER', 'PAID_MEM', 'PROMO_MEMBER']);
                const viewerMembershipActive = sessionViewer ? authnCtr.isMembershipActive(sessionViewer) : false;
                viewerIsFreeMember = viewerHasFreeRole || (viewerHasPaidRole && !viewerMembershipActive);
                viewerIsPaidMember = viewerHasPaidRole && viewerMembershipActive;
            }

            // Safety: if still unknown and not exempt (staff/admin), default to FREE to avoid leaking clear images
            if (!viewerIsFreeMember && !viewerIsPaidMember && !viewerExempt) {
                viewerIsFreeMember = true;
            }

            if (res.success && res.result && Array.isArray(res.result.docs)) {
                // Collect unique actorIds
                const actorIds = new Set<string>();
                for (const n of res.result.docs) {
                    // Accept UUID/string ids, not only ObjectId; upstream data uses UUID
                    if (n.actorId) {
                        actorIds.add(String(n.actorId));
                    }
                }

                // Batch fetch actors' age verification and populate gallery for avatarUrl
                const actorAgeVerifyMap = new Map<string, boolean>();
                const actorAvatarUrlMap = new Map<string, string | null>(); // Track actor's gallery URL
                if (actorIds.size > 0) {
                    // Query actors with roles and galleries for avatarUrl
                    const actorsResult = await userCtr.getUsers(_context, {
                        filter: { id: { $in: [...actorIds] } },
                        options: {
                            pagination: false,
                        },
                        populate: [
                            { path: 'roles' },
                            { path: 'ageVerify' },
                            { path: 'partner1', populate: [{ path: 'gallery' }] },
                            { path: 'partner2', populate: [{ path: 'gallery' }] },
                        ],
                    } as any);

                    if (actorsResult.success && Array.isArray(actorsResult.result?.docs)) {
                        // First pass: check which actors have ageVerify from getUsers
                        const actorsWithoutAgeVerify = new Set<string>();
                        for (const actor of actorsResult.result.docs) {
                            if (actor.id) {
                                // Get actor's gallery URL (from partner1 or partner2)
                                const galleryUrl = actor.partner1?.gallery?.url || actor.partner2?.gallery?.url || null;
                                actorAvatarUrlMap.set(actor.id, galleryUrl);

                                // Check if ageVerify exists in the result
                                if (actor.ageVerify) {
                                    const isActorAgeVerified = actor.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                                    actorAgeVerifyMap.set(actor.id, isActorAgeVerified);
                                }
                                else {
                                    // ageVerify not found, need to query separately
                                    actorsWithoutAgeVerify.add(actor.id);
                                }
                            }
                        }

                        // Second pass: query ageVerify for actors that don't have it
                        // Query directly from MongoDB collection (safe, only reading ageVerify field)
                        if (actorsWithoutAgeVerify.size > 0) {
                            // Query ageVerify directly from MongoDB collection
                            if (mongoose.connection.db) {
                                try {
                                    const usersCollection = mongoose.connection.db.collection('users');
                                    const ageVerifyDocs = await usersCollection.find(
                                        { id: { $in: [...actorsWithoutAgeVerify] } },
                                        { projection: { id: 1, ageVerify: 1 } },
                                    ).toArray();

                                    for (const doc of ageVerifyDocs) {
                                        const actorId = doc['id'] as string | undefined;
                                        const ageVerify = doc['ageVerify'] as { status?: string } | undefined;
                                        if (actorId) {
                                            const isActorAgeVerified = ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                                            actorAgeVerifyMap.set(actorId, isActorAgeVerified);
                                        }
                                    }

                                    // For actors not found in direct query, default to false
                                }
                                catch {
                                    // Fallback to userCtr.getUser for each actor
                                    const ageVerifyPromises = Array.from(actorsWithoutAgeVerify, async (actorId) => {
                                        try {
                                            const userResult = await userCtr.getUser(_context, {
                                                filter: { id: actorId },
                                                projection: { ageVerify: 1 },
                                            });
                                            if (userResult.success && userResult.result) {
                                                const ageVerify = userResult.result.ageVerify;
                                                const isActorAgeVerified = ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                                                actorAgeVerifyMap.set(actorId, isActorAgeVerified);
                                            }
                                            else {
                                                actorAgeVerifyMap.set(actorId, false);
                                            }
                                        }
                                        catch {
                                            actorAgeVerifyMap.set(actorId, false);
                                        }
                                    });
                                    await Promise.all(ageVerifyPromises);
                                }
                            }
                            else {
                                // Fallback to userCtr.getUser if mongoose.connection.db is not available
                                const ageVerifyPromises = Array.from(actorsWithoutAgeVerify, async (actorId) => {
                                    try {
                                        const userResult = await userCtr.getUser(_context, {
                                            filter: { id: actorId },
                                            projection: { ageVerify: 1 },
                                        });
                                        if (userResult.success && userResult.result) {
                                            const ageVerify = userResult.result.ageVerify;
                                            const isActorAgeVerified = ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                                            actorAgeVerifyMap.set(actorId, isActorAgeVerified);
                                        }
                                        else {
                                            actorAgeVerifyMap.set(actorId, false);
                                        }
                                    }
                                    catch {
                                        actorAgeVerifyMap.set(actorId, false);
                                    }
                                });
                                await Promise.all(ageVerifyPromises);
                            }
                        }
                    }
                }

                // Collect entityIds (galleryIds and eventIds) for thumbnail owner check
                const galleryEntityIds = new Set<string>();
                const eventEntityIds = new Set<string>();
                for (const n of res.result.docs) {
                    // Check if notification has thumbnail
                    const pres = n.presentation as I_NotificationPresentation;
                    if (n.entityId && pres?.thumbnailUrl) {
                        if (n.entityType === E_NotificationEntityType.MEDIA) {
                            galleryEntityIds.add(n.entityId);
                        }
                        else if (n.entityType === E_NotificationEntityType.EVENT) {
                            eventEntityIds.add(n.entityId);
                        }
                    }
                }

                // Batch fetch gallery owners' age verification
                const galleryOwnerAgeVerifyMap = new Map<string, boolean>();
                if (galleryEntityIds.size > 0) {
                    const galleriesResult = await galleryCtr.getGalleries(_context, {
                        filter: { id: { $in: [...galleryEntityIds] } },
                        options: { pagination: false },
                    });

                    if (galleriesResult.success && Array.isArray(galleriesResult.result?.docs)) {
                        for (const gallery of galleriesResult.result.docs) {
                            if (gallery.id && gallery.uploadedById) {
                                const ownerResult = await userCtr.getUser(_context, {
                                    filter: { id: gallery.uploadedById },
                                    projection: { ageVerify: 1, roles: 1 },
                                    populate: [{ path: 'roles' }],
                                });
                                if (ownerResult.success && ownerResult.result) {
                                    const isOwnerAgeVerified = ownerResult.result.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                                    galleryOwnerAgeVerifyMap.set(gallery.id, isOwnerAgeVerified);
                                }
                            }
                        }
                    }
                }

                // Batch fetch event creators' age verification
                const eventCreatorAgeVerifyMap = new Map<string, boolean>();
                if (eventEntityIds.size > 0) {
                    const eventsResult = await eventCtr.getEvents(_context, {
                        filter: { id: { $in: [...eventEntityIds] } },
                        options: { pagination: false },
                    });

                    if (eventsResult.success && Array.isArray(eventsResult.result?.docs)) {
                        for (const event of eventsResult.result.docs) {
                            if (event.id && event.createdById) {
                                const creatorResult = await userCtr.getUser(_context, {
                                    filter: { id: event.createdById },
                                    projection: { ageVerify: 1, roles: 1 },
                                    populate: [{ path: 'roles' }],
                                });
                                if (creatorResult.success && creatorResult.result) {
                                    const isCreatorAgeVerified = creatorResult.result.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                                    eventCreatorAgeVerifyMap.set(event.id, isCreatorAgeVerified);
                                }
                            }
                        }
                    }
                }

                // Apply blurring/default image based on actor's and owner's age verification status
                for (const n of res.result.docs) {
                    const pres = n.presentation as I_NotificationPresentation;
                    if (!pres)
                        continue;

                    const actorId = n.actorId;
                    const isActorAgeVerified = actorId ? (actorAgeVerifyMap.get(actorId) ?? false) : false;
                    const isActorOwner = viewerId && actorId && viewerId === actorId;

                    // actor avatar - logic based on ACTOR's age verification and VIEWER's membership status
                    const actor = pres.actor;
                    if (actor) { // Check if actor is defined
                        // Get actor's gallery URL from map
                        const actorGalleryUrlFromMap = actorId ? actorAvatarUrlMap.get(actorId) : null;
                        // Get existing avatarUrl from presentation (might already have URL from notification creation)
                        const existingAvatarUrl = actor?.avatarUrl ?? null;

                        // Get the URL to use (prioritize gallery URL from map, then existing avatarUrl in presentation)
                        const urlToUse = actorGalleryUrlFromMap ?? existingAvatarUrl;

                        // Only process if we have a URL to use
                        if (urlToUse) {
                            // Case 1: Actor chưa xác thực tuổi → mọi người khác thấy null (owner/staff/admin vẫn thấy rõ)
                            if (!isActorAgeVerified && !isActorOwner && !viewerExempt) {
                                actor.avatarUrl = null as any;
                            }
                            // Case 2: MEMBERSHIP hoặc owner/staff/admin → ảnh rõ
                            else {
                                actor.avatarUrl = bunnyCtr.generateSignedUrl({ fullUrl: urlToUse, extraQueryParams: { class: 'normal' } });
                            }
                        }
                        // If no URL at all:
                        // - Nếu không có URL, set null (không có ảnh để hiển thị)
                        else {
                            actor.avatarUrl = null as any;
                        }
                    }

                    // thumbnail / gallery / event (note: presentation.thumbnailUrl is a string)
                    if (typeof pres.thumbnailUrl === 'string' && pres.thumbnailUrl) {
                        const entityId = n.entityId;
                        let isThumbnailOwnerAgeVerified = true; // Default to true if we can't determine
                        let isThumbnailOwner = false;

                        // For MEDIA entity type (gallery), check gallery owner age verification
                        if (entityId && n.entityType === E_NotificationEntityType.MEDIA) {
                            // Check from batch-fetched map first
                            const cachedAgeVerified = galleryOwnerAgeVerifyMap.get(entityId);
                            if (cachedAgeVerified !== undefined) {
                                isThumbnailOwnerAgeVerified = cachedAgeVerified;
                            }
                            else {
                                // If not in cache, fetch it now
                                try {
                                    const galleryResult = await galleryCtr.getGallery(_context, {
                                        filter: { id: entityId },
                                    });
                                    if (galleryResult.success && galleryResult.result?.uploadedById) {
                                        const ownerResult = await userCtr.getUser(_context, {
                                            filter: { id: galleryResult.result.uploadedById },
                                            projection: { ageVerify: 1 },
                                        });
                                        if (ownerResult.success && ownerResult.result) {
                                            isThumbnailOwnerAgeVerified = ownerResult.result.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
                                        }

                                        // Check if viewer is the owner
                                        if (viewerId && galleryResult.result.uploadedById === viewerId) {
                                            isThumbnailOwner = true;
                                        }
                                    }
                                }
                                catch {
                                    // If fetch fails, assume verified to avoid blocking
                                }
                            }

                            // Check if viewer is the owner (if not already checked above)
                            if (!isThumbnailOwner && viewerId) {
                                try {
                                    const galleryResult = await galleryCtr.getGallery(_context, {
                                        filter: { id: entityId },
                                    });
                                    if (galleryResult.success && galleryResult.result?.uploadedById === viewerId) {
                                        isThumbnailOwner = true;
                                    }
                                }
                                catch {
                                    // If fetch fails, assume not owner
                                }
                            }
                        }
                        // For EVENT entity type (announcement), skip gating: visible to everyone
                        else if (n.entityType === E_NotificationEntityType.EVENT) {
                            pres.thumbnailUrl = bunnyCtr.generateSignedUrl({
                                fullUrl: pres.thumbnailUrl,
                                extraQueryParams: { class: 'normal' },
                            });
                            continue;
                        }

                        // Logic based on THUMBNAIL OWNER's age verification and VIEWER's membership status
                        // Case 1: Owner chưa xác thực tuổi → người khác thấy null (owner/staff/admin vẫn thấy rõ)
                        if (!isThumbnailOwnerAgeVerified && !isThumbnailOwner && !viewerExempt) {
                            pres.thumbnailUrl = null as any;
                        }
                        // Case 2: Viewer là FREE_MEMBER → blur ảnh của người khác
                        else if (viewerIsFreeMember && !isThumbnailOwner && !viewerExempt) {
                            pres.thumbnailUrl = bunnyCtr.generateBlurredUrl({ fullUrl: pres.thumbnailUrl, extraQueryParams: { class: 'blur' } });
                        }
                        // Case 3: MEMBERSHIP hoặc owner/staff/admin → ảnh rõ
                        else {
                            pres.thumbnailUrl = bunnyCtr.generateSignedUrl({ fullUrl: pres.thumbnailUrl, extraQueryParams: { class: 'normal' } });
                        }
                    }
                }
            }
        }
        catch {
            // non-fatal: if anything fails while enriching presentation, return original result
        }

        return res;
    },

    createNotification: async (_context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreateNotification>) => {
        const { targetId, entityType, entityId } = doc;
        const types: E_NotificationType[] = Array.isArray(doc.type) ? doc.type as E_NotificationType[] : (doc.type ? [doc.type as E_NotificationType] : []);

        if (!targetId)
            throwError({ message: 'targetId is required', status: RESPONSE_STATUS.BAD_REQUEST });
        if (types.length === 0)
            throwError({ message: 'Notification type is required', status: RESPONSE_STATUS.BAD_REQUEST });
        if (entityType && !entityId)
            throwError({ message: 'entityId is required when entityType is provided', status: RESPONSE_STATUS.BAD_REQUEST });

        // channels mặc định đã có default IN_APP ở model, nhưng nếu muốn override từ doc thì dùng doc.channels
        const channels = (doc.channels && doc.channels.length > 0) ? doc.channels : undefined;

        // LƯU Y NGUYÊN SI presentation TỪ CLIENT
        const persistType = (types.length === 1 ? types[0] : types) as unknown as I_Notification['type'];
        const { ...base } = doc as I_Input_CreateNotification;

        const result = await mongooseCtr.createOne({
            ...base,
            type: persistType,
            channels,
            status: E_NotificationStatus.QUEUED,
        });

        if (result.success) {
            // gán lại presentation từ client (nếu có)
            if (doc.presentation) {
                await mongooseCtr.updateOne({ id: result.result.id }, { presentation: doc.presentation });
                result.result.presentation = doc.presentation;
            }

            if (hasInApp(result.result)) {
                const payload: I_NotificationAddedPayload = { notification: result.result, presentation: result.result.presentation };
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, payload);
            }
        }
        return result;
    },

    createNotificationWithSettings: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateNotification>,
    ) => {
        const { targetId, entityType, entityId } = doc;

        const types: E_NotificationType[] = Array.isArray(doc.type)
            ? (doc.type as E_NotificationType[])
            : (doc.type ? [doc.type as E_NotificationType] : []);

        if (!targetId) {
            throwError({ message: 'targetId is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        if (types.length === 0) {
            throwError({ message: 'Notification type is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        if (entityType && !entityId) {
            throwError({ message: 'entityId is required when entityType is provided', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // normalize id (UUID/string/ObjectId)
        const tid = String(targetId).trim();
        const orFilters: any[] = [{ targetId: tid }, { id: tid }];
        if (isValidObjectId(tid)) {
            orFilters.push({ _id: new Types.ObjectId(tid) });
        }

        // optional: skip notifying current session user
        // Allow self-notify for certain types (age verification)
        const currentUser = await authnCtr.getUserFromSession(context).catch(() => null);
        const currentUserId = currentUser?.id;
        const allowSelfNotify = types.includes(E_NotificationType.AGE_VERIFICATION_APPROVED)
            || types.includes(E_NotificationType.AGE_VERIFICATION_SUBMITTED)
            || types.includes(E_NotificationType.AGE_VERIFICATION_SKIPPED)
            || types.includes(E_NotificationType.AGE_VERIFICATION_REJECTED);
        if (currentUserId && String(currentUserId) === tid && !allowSelfNotify) {
            return { success: true, message: null };
        }

        // lookup recipient by any supported key
        const userFound = await userCtr.getUser(context, { filter: { $or: orFilters } });
        if (!userFound?.success) {
            throwError({ message: 'Target user not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const isTargetDeleted = userFound.result?.isDel === true;
        const isProfileComplete = userFound.result?.registerStep === E_RegisterStep.COMPLETE;
        const allowIncompleteProfile = types.some(type => ALLOW_INCOMPLETE_PROFILE_TYPES.has(type));

        // Không gửi thông báo nếu user đã bị xóa
        if (isTargetDeleted) {
            return { success: true, message: null };
        }

        // Cho phép một số loại noti gửi tới user chưa hoàn tất hồ sơ (ví dụ: lời mời tham gia nhóm)
        if (!isProfileComplete && !allowIncompleteProfile) {
            return { success: true, message: null };
        }

        // Respect blocks: do not notify if there is a bidirectional block between actor and target
        const blockedUserIds = await getBlockedUserIds(context);
        if (userFound.result?.id && blockedUserIds.has(userFound.result.id)) {
            return { success: true, message: null };
        }

        const rawSettings = userFound.result.settings?.notification ?? {};
        // Default to true if not explicitly set (null/undefined means true by default)
        const s = {
            gainFollower: rawSettings.gainFollower !== false,
            receiveMessage: rawSettings.receiveMessage !== false,
            newMemberJoined: rawSettings.newMemberJoined !== false,
            followingPostAnnouncement: rawSettings.followingPostAnnouncement !== false,
        };
        const has = (t: E_NotificationType) => types.includes(t);

        // --- Helper: area-of-interest filtering for location-based notifications ---
        const LEVEL_TO_RADIUS_MAP: Record<number, number> = {
            13: 5,
            12: 10,
            11: 25,
            10: 50,
            9: 75,
            8: 100,
            7: 150,
            6: 250,
            5: 500,
            4: 1000,
        };
        const DEFAULT_RADIUS_KM = 25;

        const convertLevelToRadius = (level?: number): number => {
            if (!level || Number.isNaN(level))
                return DEFAULT_RADIUS_KM;
            const closest = Object.keys(LEVEL_TO_RADIUS_MAP)
                .map(Number)
                .reduce((prev, curr) => Math.abs(curr - level) < Math.abs(prev - level) ? curr : prev);
            return LEVEL_TO_RADIUS_MAP[closest] || DEFAULT_RADIUS_KM;
        };

        const viewport = (lat?: number, lng?: number, level?: number) => {
            if (typeof lat !== 'number' || Number.isNaN(lat))
                return null;
            if (typeof lng !== 'number' || Number.isNaN(lng))
                return null;
            // level can be undefined, convertLevelToRadius handles it

            const radiusKm = convertLevelToRadius(level);
            const radiusMeters = radiusKm * 1000;

            const deltaLat = radiusMeters / 110540;
            const deltaLng = radiusMeters / (111200 * Math.cos((lat * Math.PI) / 180));

            return {
                northEastLatitude: lat + deltaLat,
                northEastLongitude: lng + deltaLng,
                southWestLatitude: lat - deltaLat,
                southWestLongitude: lng - deltaLng,
            };
        };

        const isPointInsideViewport = (
            lat: number,
            lng: number,
            area?: ReturnType<typeof viewport>,
        ): boolean => {
            if (!area)
                return false;

            const withinLat = lat >= area.southWestLatitude && lat <= area.northEastLatitude;
            let withinLng = false;
            if (area.southWestLongitude <= area.northEastLongitude) {
                withinLng = lng >= area.southWestLongitude && lng <= area.northEastLongitude;
            }
            else {
                // Handle wrap-around at antimeridian
                withinLng = lng >= area.southWestLongitude || lng <= area.northEastLongitude;
            }
            return withinLat && withinLng;
        };

        const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const toRad = (v: number) => (v * Math.PI) / 180;
            const R = 6371; // Earth radius km
            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        const isTempActive = (tempLoc?: NonNullable<any>) => {
            if (!tempLoc)
                return false;
            if (!tempLoc.endAt)
                return true;
            try {
                const end = new Date(tempLoc.endAt);
                if (Number.isNaN(end.getTime()))
                    return false;
                const isMidnight = end.getHours() === 0
                    && end.getMinutes() === 0
                    && end.getSeconds() === 0
                    && end.getMilliseconds() === 0;
                const normalizedEnd = isMidnight ? new Date(end.getTime() + 24 * 60 * 60 * 1000 - 1) : end;
                return normalizedEnd > new Date();
            }
            catch {
                return false;
            }
        };

        const getEffectiveMap = (u?: any) => {
            if (!u)
                return null;
            const temp = u.settings?.temporaryLocation;
            if (temp && isTempActive(temp)) {
                if (temp.location?.map) {
                    return temp.location.map;
                }
                // If Temp Location is ACTIVE but map data is missing,
                // assume user is 'somewhere else' (unknown) but NOT at home.
                // Do NOT fallback to partner location.
                return null;
            }
            if (u.partner1?.location?.map)
                return u.partner1.location.map;
            if (u.partner2?.location?.map)
                return u.partner2.location.map;
            return null;
        };

        let cachedInterestRecipient: Awaited<ReturnType<typeof userCtr.getUser>> | null | undefined;
        const loadInterestRecipient = async () => {
            if (cachedInterestRecipient !== undefined) {
                return cachedInterestRecipient;
            }
            cachedInterestRecipient = await userCtr.getUser(context, {
                filter: { $or: orFilters },
                populate: ['partner1.location', 'partner2.location', 'settings.temporaryLocation.location'],
            }).catch(() => null);
            return cachedInterestRecipient;
        };

        let cachedIsFollower: boolean | undefined;
        const isTargetFollowingActor = async (): Promise<boolean> => {
            if (cachedIsFollower !== undefined) {
                return cachedIsFollower;
            }
            if (!doc.actorId || !doc.targetId) {
                cachedIsFollower = false;
                return false;
            }
            try {
                const followFound = await followCtr.getFollow(context, {
                    filter: { userId: doc.targetId, followId: doc.actorId },
                });
                cachedIsFollower = Boolean(followFound.success && followFound.result);
                return cachedIsFollower;
            }
            catch {
                cachedIsFollower = false;
                return false;
            }
        };

        // If notification type is a 'new member in your area' then perform geofence check
        // Only send notification when BOTH actor AND recipient have valid location data
        // and the actor is within the recipient's area of interest
        if (has(E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST)) {
            try {
                // Actor / new member id is in doc.entityId or doc.actorId
                const actorId = String(doc.actorId ?? doc.entityId ?? '').trim();
                if (!actorId) {
                    log.info('[Notification] NEW_MEMBER: no actorId — skipping', { targetId: tid });
                    return { success: true, message: null };
                }

                // Fetch actor (new user) with needed location data
                const actorFound = await userCtr.getUser(context, { filter: { id: actorId }, populate: ['partner1.location', 'partner2.location', 'settings.temporaryLocation.location'] }).catch(() => null);
                if (!actorFound?.success || !actorFound.result) {
                    log.info('[Notification] NEW_MEMBER: actor user not found — skipping', { actorId, targetId: tid });
                    return { success: true, message: null };
                }
                const actorMap = getEffectiveMap(actorFound.result as any);
                if (!actorMap || typeof actorMap.latitude !== 'number' || typeof actorMap.longitude !== 'number') {
                    // Actor has no location → skip (only notify within area of interest)
                    log.info('[Notification] NEW_MEMBER: actor has no location — skipping', { actorId, targetId: tid });
                    return { success: true, message: null };
                }

                // Actor has location → perform geofence check against recipient
                const recipient = await loadInterestRecipient();
                if (!recipient?.success || !recipient.result) {
                    log.info('[Notification] NEW_MEMBER: recipient not found — skipping', { actorId, targetId: tid });
                    return { success: true, message: null };
                }

                const recipientMap = getEffectiveMap(recipient.result as any);
                if (!recipientMap || typeof recipientMap.latitude !== 'number' || typeof recipientMap.longitude !== 'number') {
                    // Recipient has no location → skip (can't determine area of interest)
                    log.info('[Notification] NEW_MEMBER: recipient has no location — skipping', { actorId, targetId: tid });
                    return { success: true, message: null };
                }

                // Both have locations → perform geofence check
                const zoomLevel = recipient.result.settings?.zoomLevel as number | undefined;
                const radiusKm = convertLevelToRadius(zoomLevel);
                const interestViewport = viewport(recipientMap.latitude, recipientMap.longitude, zoomLevel);

                if (!isPointInsideViewport(actorMap.latitude, actorMap.longitude, interestViewport)) {
                    log.info('[Notification] NEW_MEMBER: actor outside recipient viewport — skipping', { actorId, targetId: tid, radiusKm });
                    return { success: true, message: null };
                }

                const distanceKm = haversineKm(recipientMap.latitude, recipientMap.longitude, actorMap.latitude, actorMap.longitude);
                if (distanceKm > radiusKm) {
                    log.info('[Notification] NEW_MEMBER: actor outside radius — skipping', { actorId, targetId: tid, distanceKm, radiusKm });
                    return { success: true, message: null };
                }
            }
            catch (err) {
                // On geofence error, skip notification to avoid global notifications
                log.warn('[Notification] NEW_MEMBER: geofence check error — skipping', { targetId: tid, error: err });
                return { success: true, message: null };
            }
        }

        if (has(E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED)) {
            const isFollowingActor = await isTargetFollowingActor();
            if (isFollowingActor) {
                // Target is following the actor → always send (follower notification)
                // Fall through to create notification
            }
            else {
                // Target is NOT following → must pass area-of-interest geofence check
                try {
                    const redirectMap = doc.presentation?.redirect?.map;
                    if (!isValidMap(redirectMap)) {
                        // Event has no valid location → skip (only notify within area of interest)
                        log.info('[Notification] NEW_ANNOUNCEMENT: event has no valid map — skipping', { targetId: tid, actorId: doc.actorId });
                        return { success: true, message: null };
                    }

                    const recipient = await loadInterestRecipient();
                    if (!recipient?.success || !recipient.result) {
                        log.info('[Notification] NEW_ANNOUNCEMENT: recipient not found — skipping', { targetId: tid });
                        return { success: true, message: null };
                    }

                    const recipientMap = getEffectiveMap(recipient.result as any);
                    if (!recipientMap || typeof recipientMap.latitude !== 'number' || typeof recipientMap.longitude !== 'number') {
                        // Recipient has no location → skip (can't determine area of interest)
                        log.info('[Notification] NEW_ANNOUNCEMENT: recipient has no location — skipping', { targetId: tid });
                        return { success: true, message: null };
                    }

                    // Both have locations → perform geofence check
                    const eventLat = redirectMap!.latitude!;
                    const eventLng = redirectMap!.longitude!;
                    const zoomLevel = recipient.result.settings?.zoomLevel as number | undefined;
                    const radiusKm = convertLevelToRadius(zoomLevel);
                    const interestViewport = viewport(recipientMap.latitude, recipientMap.longitude, zoomLevel);
                    if (!isPointInsideViewport(eventLat, eventLng, interestViewport)) {
                        log.info('[Notification] NEW_ANNOUNCEMENT: event outside recipient viewport — skipping', { targetId: tid, radiusKm });
                        return { success: true, message: null };
                    }

                    const distanceKm = haversineKm(
                        recipientMap.latitude,
                        recipientMap.longitude,
                        eventLat,
                        eventLng,
                    );
                    if (distanceKm > radiusKm) {
                        log.info('[Notification] NEW_ANNOUNCEMENT: event outside radius — skipping', { targetId: tid, distanceKm, radiusKm });
                        return { success: true, message: null };
                    }
                }
                catch (err) {
                    // On geofence error, skip notification to avoid global notifications
                    log.warn('[Notification] NEW_ANNOUNCEMENT: geofence check error — skipping', { targetId: tid, error: err });
                    return { success: true, message: null };
                }
            }
        }

        // channels
        // If channels are explicitly provided in doc, use them
        // Otherwise, build channels based on notification type and user settings
        let channels: E_NotificationChannel[];
        if (doc.channels && Array.isArray(doc.channels) && doc.channels.length > 0) {
            // Use explicitly provided channels
            channels = doc.channels as E_NotificationChannel[];
        }
        else {
            // Build channels based on notification type and settings
            const channelSet = new Set<E_NotificationChannel>([E_NotificationChannel.IN_APP]);

            if (has(E_NotificationType.NEW_FOLLOWER) && s.gainFollower) {
                channelSet.add(E_NotificationChannel.EMAIL);
            }
            if (has(E_NotificationType.NEW_MESSAGE) && s.receiveMessage) {
                channelSet.add(E_NotificationChannel.EMAIL);
            }
            if (has(E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST) && s.newMemberJoined) {
                channelSet.add(E_NotificationChannel.EMAIL);
            }
            if (has(E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED) && s.followingPostAnnouncement) {
                channelSet.add(E_NotificationChannel.EMAIL);
            }
            if (has(E_NotificationType.MEDIA_LIKED)) {
                channelSet.add(E_NotificationChannel.EMAIL);
            }

            // force email-only for receipts/payment issues
            if (has(E_NotificationType.RECEIPT_EMAIL_ONLY) || has(E_NotificationType.PAYMENT_ISSUE)) {
                channelSet.clear();
                channelSet.add(E_NotificationChannel.EMAIL);
            }

            channels = [...channelSet];
        }
        const persistType = (types.length === 1 ? types[0] : types) as unknown as I_Notification['type'];

        const result = await mongooseCtr.createOne({
            ...(doc as I_Input_CreateNotification),
            type: persistType,
            channels,
            status: E_NotificationStatus.QUEUED,
            isEmailSuppressed: false,
        });

        if (result.success) {
            // LƯU NGUYÊN SI presentation từ client, KHÔNG build/enrich
            if (doc.presentation) {
                await mongooseCtr.updateOne({ id: result.result.id }, { presentation: doc.presentation });
                result.result.presentation = doc.presentation;
            }

            // Publish in-app notifications
            if (result.result.channels?.includes(E_NotificationChannel.IN_APP)) {
                const payload: I_NotificationAddedPayload = {
                    notification: result.result,
                    presentation: result.result.presentation,
                };
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, payload);
            }
            else {
                // If no IN_APP channel, ensure presentation is null
            }

            // If EMAIL channel is requested, send email immediately (no cron)
            if (result.result.channels?.includes(E_NotificationChannel.EMAIL) && !result.result.isEmailSuppressed) {
                (async () => {
                    try {
                        const userRes = await userCtr.getUser({}, { filter: { id: result.result.targetId } });
                        const targetEmail = userRes.success && userRes.result ? userRes.result.email : '';
                        if (!targetEmail) {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.FAILED });
                            return;
                        }

                        // Determine template key from notification type (first type if array)
                        const tRaw = Array.isArray(result.result.type) ? result.result.type[0] : result.result.type;
                        const t = tRaw as E_NotificationType;
                        let templateKey: string | '';
                        const templateData: Record<string, any> = {};
                        let sendRes;
                        switch (t) {
                            case E_NotificationType.NEW_FOLLOWER:
                                templateKey = NEW_FOLLOWER;
                                break;
                            case E_NotificationType.NEW_MESSAGE:
                                templateKey = NEW_MESSAGE;
                                break;
                            case E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST:
                                templateKey = NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST;
                                break;
                            case E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED:
                                templateKey = NEW_ANNOUNCEMENT_FOLLOWED_OR_NEARBY;
                                break;
                            case E_NotificationType.PAYMENT_ISSUE:
                                templateKey = PAYMENT_FAILED;
                                break;
                            case E_NotificationType.AGE_VERIFICATION_SKIPPED:
                                templateKey = AGE_VERIFICATION_SKIPPED;
                                break;
                            case E_NotificationType.MEDIA_LIKED: {
                                templateKey = '';
                                const presentation = (result.result.presentation ?? doc.presentation) as I_NotificationPresentation | undefined;
                                const actorDisplayName = 'Someone'; // Placeholder, not used in email
                                const isVideo = Boolean((presentation?.context as any)?.isVideo);
                                const mediaKindLabel = isVideo ? 'video' : 'picture';
                                const ownerUsername = (presentation?.context as any)?.profileOwnerUsername;
                                const mediaLink = buildMediaLikedLink(ownerUsername, result.result.entityId ?? doc.entityId);
                                // Don't pass thumbnailUrl to comply with Postmark (no images)
                                // Don't pass targetDisplayName to comply with Postmark (no usernames)
                                sendRes = await sendMediaLikedEmail({
                                    targetEmail,
                                    targetDisplayName: undefined, // Don't pass username to comply with Postmark rules
                                    actorDisplayName,
                                    mediaKindLabel,
                                    mediaLink,
                                    thumbnailUrl: undefined, // No images in emails
                                });
                                break;
                            }
                            default:
                                templateKey = '';
                        }

                        if (!sendRes) {
                            if (templateKey) {
                                sendRes = await emailCtr.sendEmail(templateKey, targetEmail, templateData).catch(e => ({ success: false, message: (e as Error).message }));
                            }
                            else {
                                await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.SENT });
                                return;
                            }
                        }

                        if (sendRes && (sendRes as any).success) {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.SENT });
                        }
                        else {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.FAILED });
                        }
                    }
                    catch {
                        try {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.FAILED });
                        }
                        catch {
                            // ignore
                        }
                        // log but don't crash the main flow
                    }
                })();
            }
        }

        return result;
    },

    updateNotification: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        const result = await mongooseCtr.updateOne(filter, update, options);

        if (result.success && hasInApp(result.result)) {
            const payload: I_NotificationUpdatedPayload = { notification: result.result };
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_UPDATED, payload);
        }

        return result;
    },
    deleteNotification: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryNotification>,
    ): Promise<I_Return<I_Notification | null>> => {
        const notificationId = typeof filter?.id === 'string'
            ? filter.id.trim()
            : '';
        if (!notificationId) {
            throwError({ message: 'Filter.id is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const userId = context.req?.session?.user?.id;
        if (!userId) {
            throwError({ message: 'User not authenticated.', status: RESPONSE_STATUS.UNAUTHORIZED });
        }

        const result = await mongooseCtr.deleteOne({ id: notificationId, targetId: userId }, options);

        // Idempotent delete: treat "not found" as success to avoid forcing users to click twice.
        if (!result.success) {
            const message = (result.message ?? '').toLowerCase();
            if (message.includes('not found') || message.includes('no document')) {
                return { success: true, message: 'Notification already deleted', result: null };
            }
            return result as unknown as I_Return<I_Notification | null>;
        }

        if (hasInApp(result.result)) {
            const payload: I_NotificationDeletedPayload = {
                notificationId,
                targetId: result.result.targetId!,
            };
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_DELETED, payload);
        }
        return result as unknown as I_Return<I_Notification | null>;
    },

    /**
     * Delete all notifications for the current user
     */
    deleteNotifications: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteMany<I_Input_QueryNotification>,
    ): Promise<I_Return<T_DeleteResult>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        if (!currentUser) {
            throwError({ message: 'User not authenticated.', status: RESPONSE_STATUS.UNAUTHORIZED });
        }

        // Optionally, publish a notification event for bulk delete
        // pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_DELETED, { notificationId: null, targetId: userId });
        return mongooseCtr.deleteMany({ ...filter, targetId: currentUser.id }, options);
    },
    markNotificationRead: async (
        context: I_Context,
        { filter }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        if (!filter?.['id']) {
            throwError({ message: 'Filter.id is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const userId = context.req?.session?.user?.id;
        const owned = await mongooseCtr.findOne({ id: filter['id'], targetId: userId });
        if (!owned.success) {
            throwError({ message: 'Notification not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const result = await mongooseCtr.updateOne(
            { id: filter['id'], targetId: userId },
            { status: E_NotificationStatus.READ, readAt: new Date() },
        );

        if (result.success && hasInApp(result.result)) {
            const payload: I_NotificationReadPayload = {
                notificationId: result.result.id!,
                targetId: result.result.targetId!,
                readAt: result.result.readAt!,
            };
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_READ, payload);
        }

        return result;
    },
    dismissNotification: async (
        context: I_Context,
        { filter }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        if (!filter?.['id']) {
            throwError({ message: 'Filter.id is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const userId = context.req?.session?.user?.id;
        const owned = await mongooseCtr.findOne({ id: filter['id'], targetId: userId });
        if (!owned.success) {
            throwError({ message: 'Notification not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const result = await mongooseCtr.updateOne(
            { id: filter['id'], targetId: userId },
            { status: E_NotificationStatus.DISMISSED, dismissedAt: new Date() },
        );

        if (result.success && hasInApp(result.result)) {
            const payload: I_NotificationDismissedPayload = {
                notificationId: result.result.id!,
                targetId: result.result.targetId!,
                dismissedAt: result.result.dismissedAt!,
            };
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_DISMISSED, payload);
        }

        return result;
    },
    subscribeToNotificationAdded: () =>
        withFilter<I_NotificationAddedPayload, { userId?: string }, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED]),
            async (payload, _variables, context) => {
                const currentUserId = context?.req?.session?.user?.id;
                return !!currentUserId && payload?.notification.targetId === currentUserId;
            },
        ),

    subscribeToNotificationUpdated: () =>
        withFilter<I_NotificationUpdatedPayload, { userId?: string }, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_NOTIFICATION_EVENTS.NOTIFICATION_UPDATED]),
            async (payload, _variables, context) => {
                const currentUserId = context?.req?.session?.user?.id;
                return !!currentUserId && payload?.notification.targetId === currentUserId;
            },
        ),

    subscribeToNotificationRead: () =>
        withFilter<I_NotificationReadPayload, { userId?: string }, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_NOTIFICATION_EVENTS.NOTIFICATION_READ]),
            async (payload, _vars, context) => {
                const currentUserId = context?.req?.session?.user?.id;
                return !!currentUserId && payload?.targetId === currentUserId;
            },
        ),

    subscribeToNotificationDismissed: () =>
        withFilter<I_NotificationDismissedPayload, { userId?: string }, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_NOTIFICATION_EVENTS.NOTIFICATION_DISMISSED]),
            async (payload, _vars, context) => {
                const currentUserId = context?.req?.session?.user?.id;
                return !!currentUserId && payload?.targetId === currentUserId;
            },
        ),

    subscribeToNotificationDeleted: () =>
        withFilter<I_NotificationDeletedPayload, { userId?: string }, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_NOTIFICATION_EVENTS.NOTIFICATION_DELETED]),
            async (payload, _vars, context) => {
                const currentUserId = context?.req?.session?.user?.id;
                return !!currentUserId && payload?.targetId === currentUserId;
            },
        ),
};
