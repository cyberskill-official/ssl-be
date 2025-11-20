import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { withFilter } from 'graphql-subscriptions';
import { isValidObjectId, Types } from 'mongoose';

import type { I_Context, I_WsContext } from '#shared/typescript/index.js';

import { NEW_ANNOUNCEMENT_FOLLOWED_OR_NEARBY, NEW_FOLLOWER, NEW_MEMBER_JOIN_IN_YOUR_AREA_INTEREST, NEW_MESSAGE, PAYMENT_FAILED } from '#modules/authn/authn.constant.js';
import { authnCtr, E_AgeVerifyStatus, E_RegisterStep } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { messageStatusCtr } from '#modules/conversation/index.js';
import { emailCtr } from '#modules/email/index.js';
import { followCtr } from '#modules/follow/index.js';
import { userCtr } from '#modules/user/index.js';
import { pubsub } from '#shared/graphql/pubsub.js';

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

import { NotificationModel } from './notification.model.js';
import {
    E_NOTIFICATION_EVENTS,
    E_NotificationChannel,
    E_NotificationStatus,
    E_NotificationType,
    OTHER_TYPES,
} from './notification.type.js';
import { hasInApp, isValidMap } from './notification.util.js';

const mongooseCtr = new MongooseController<I_Notification>(NotificationModel);

const ALLOW_INCOMPLETE_PROFILE_TYPES = new Set<E_NotificationType>([
    E_NotificationType.GROUP_JOIN_REQUEST,
    E_NotificationType.GROUP_JOIN_APPROVED,
]);

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

    getNotificationCounters: async (context: I_Context) => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const userId = currentUser.id;

        if (!userId) {
            return { numberOfConversationUnRead: 0, numberOfOtherUnRead: 0 };
        }

        const [numberOfOtherUnRead, numberOfConversationUnRead] = await Promise.all([
            notificationCtr.countOtherUnreadInApp(context, userId),
            messageStatusCtr.countUnreadConversations(context, userId),
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
            else if (OTHER_TYPES.includes(inputType)) {
                f.type = inputType;
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

        // Enrich presentation media (avatar, thumbnails) according to viewer age verification
        try {
            let isViewerVerified = false;
            try {
                const viewer = await authnCtr.getUserFromSession(_context);
                isViewerVerified = viewer?.ageVerify?.status === E_AgeVerifyStatus.APPROVED;
            }
            catch {
                isViewerVerified = false;
            }

            if (res.success && res.result && Array.isArray(res.result.docs)) {
                for (const n of res.result.docs) {
                    const pres = n.presentation as I_NotificationPresentation;
                    if (!pres)
                        continue;

                    // actor avatar
                    const actor = pres.actor;
                    if (actor?.avatarUrl) {
                        actor.avatarUrl = isViewerVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: actor.avatarUrl, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: actor.avatarUrl, extraQueryParams: { class: 'blur' } });
                    }

                    // thumbnail / gallery (note: presentation.thumbnailUrl is a string)
                    if (typeof pres.thumbnailUrl === 'string' && pres.thumbnailUrl) {
                        pres.thumbnailUrl = isViewerVerified
                            ? bunnyCtr.generateSignedUrl({ fullUrl: pres.thumbnailUrl, extraQueryParams: { class: 'normal' } })
                            : bunnyCtr.generateBlurredUrl({ fullUrl: pres.thumbnailUrl, extraQueryParams: { class: 'blur' } });
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
        const currentUser = await authnCtr.getUserFromSession(context).catch(() => null);
        const currentUserId = currentUser?.id;
        if (currentUserId && String(currentUserId) === tid) {
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

        const s = userFound.result.settings?.notification ?? {};
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
        const DEFAULT_RADIUS_KM = 50;

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
            if (typeof level !== 'number' || Number.isNaN(level))
                return null;

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
            try {
                if (!tempLoc?.endAt)
                    return false;
                const end = new Date(tempLoc.endAt);
                const isMidnight = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0 && end.getMilliseconds() === 0;
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
            if (temp && isTempActive(temp) && temp.location?.map) {
                return temp.location.map;
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
        if (has(E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST)) {
            try {
                // Actor / new member id is in doc.entityId or doc.actorId
                const actorId = String(doc.actorId ?? doc.entityId ?? '').trim();
                if (!actorId) {
                    // Can't determine actor location → skip sending
                    return { success: true, message: null };
                }

                // Fetch actor (new user) with needed location data
                const actorFound = await userCtr.getUser(context, { filter: { id: actorId }, populate: ['partner1.location', 'partner2.location', 'settings.temporaryLocation.location'] }).catch(() => null);
                if (!actorFound?.success || !actorFound.result) {
                    return { success: true, message: null };
                }
                const actorMap = getEffectiveMap(actorFound.result as any);
                if (!actorMap || typeof actorMap.latitude !== 'number' || typeof actorMap.longitude !== 'number') {
                    return { success: true, message: null };
                }

                // Fetch recipient (target) with location & zoom data so we can test area-of-interest
                const recipient = await loadInterestRecipient();
                if (!recipient?.success || !recipient.result) {
                    return { success: true, message: null };
                }

                const recipientMap = getEffectiveMap(recipient.result as any);
                if (!recipientMap || typeof recipientMap.latitude !== 'number' || typeof recipientMap.longitude !== 'number') {
                    // recipient has no center for area-of-interest → skip
                    return { success: true, message: null };
                }

                // Determine radius from recipient zoomLevel setting (fallback to default)
                const zoomLevel = recipient.result.settings?.zoomLevel as number | undefined;
                const radiusKm = convertLevelToRadius(zoomLevel);
                const interestViewport = viewport(recipientMap.latitude, recipientMap.longitude, zoomLevel);

                if (!isPointInsideViewport(actorMap.latitude, actorMap.longitude, interestViewport)) {
                    return { success: true, message: null };
                }

                const distanceKm = haversineKm(recipientMap.latitude, recipientMap.longitude, actorMap.latitude, actorMap.longitude);
                if (distanceKm > radiusKm) {
                    // Actor is outside recipient's area of interest → do not notify
                    return { success: true, message: null };
                }
            }
            catch {
                // On any error during geofence check, be conservative and skip notifying
                return { success: true, message: null };
            }
        }

        if (has(E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED)) {
            const skipInterestArea = await isTargetFollowingActor();
            if (!skipInterestArea) {
                try {
                    const redirectMap = doc.presentation?.redirect?.map;
                    if (!isValidMap(redirectMap)) {
                        return { success: true, message: null };
                    }

                    const recipient = await loadInterestRecipient();
                    if (!recipient?.success || !recipient.result) {
                        return { success: true, message: null };
                    }

                    const recipientMap = getEffectiveMap(recipient.result as any);
                    if (!recipientMap || typeof recipientMap.latitude !== 'number' || typeof recipientMap.longitude !== 'number') {
                        return { success: true, message: null };
                    }

                    const zoomLevel = recipient.result.settings?.zoomLevel as number | undefined;
                    const radiusKm = convertLevelToRadius(zoomLevel);
                    const interestViewport = viewport(recipientMap.latitude, recipientMap.longitude, zoomLevel);
                    if (!redirectMap || !isPointInsideViewport(redirectMap.latitude!, redirectMap.longitude!, interestViewport)) {
                        return { success: true, message: null };
                    }

                    const distanceKm = haversineKm(
                        recipientMap.latitude,
                        recipientMap.longitude,
                        redirectMap.latitude!,
                        redirectMap.longitude!,
                    );
                    if (distanceKm > radiusKm) {
                        return { success: true, message: null };
                    }
                }
                catch {
                    return { success: true, message: null };
                }
            }
        }

        // channels
        const channelSet = new Set<E_NotificationChannel>([E_NotificationChannel.IN_APP]);

        if (has(E_NotificationType.NEW_FOLLOWER) && s.gainFollower === true) {
            channelSet.add(E_NotificationChannel.EMAIL);
        }
        if (has(E_NotificationType.NEW_MESSAGE) && s.receiveMessage === true) {
            channelSet.add(E_NotificationChannel.EMAIL);
        }
        if (has(E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST) && s.newMemberJoined === true) {
            channelSet.add(E_NotificationChannel.EMAIL);
        }
        if (has(E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED) && s.followingPostAnnouncement === true) {
            channelSet.add(E_NotificationChannel.EMAIL);
        }

        // force email-only for receipts/payment issues
        if (has(E_NotificationType.RECEIPT_EMAIL_ONLY) || has(E_NotificationType.PAYMENT_ISSUE)) {
            channelSet.clear();
            channelSet.add(E_NotificationChannel.EMAIL);
        }

        const channels = Array.from(channelSet);
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
                            default:
                                templateKey = '';
                        }

                        let sendRes;
                        if (templateKey) {
                            sendRes = await emailCtr.sendEmail(templateKey, targetEmail).catch(e => ({ success: false, message: (e as Error).message }));
                        }
                        else {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.SENT });
                            return;
                        }

                        if (sendRes && (sendRes as any).success) {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.SENT });
                        }
                        else {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.FAILED });
                        }
                    }
                    catch (err) {
                        try {
                            await mongooseCtr.updateOne({ id: result.result.id }, { status: E_NotificationStatus.FAILED });
                        }
                        catch {
                            // ignore
                        }
                        // log but don't crash the main flow
                        log.error('[NOTIFICATION] immediate email send failed:', err);
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
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryNotification>,
    ): Promise<I_Return<I_Notification>> => {
        const result = await mongooseCtr.deleteOne(filter, options);

        if (result.success && hasInApp(result.result)) {
            const payload: I_NotificationDeletedPayload = {
                notificationId: filter.id!,
                targetId: result.result.targetId!,
            };
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_DELETED, payload);
        }
        return result;
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
