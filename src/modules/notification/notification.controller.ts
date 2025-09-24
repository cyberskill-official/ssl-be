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
import { withFilter } from 'graphql-subscriptions';

import type { I_Context, I_WsContext } from '#shared/typescript/index.js';

import { bunnyCtr } from '#modules/bunny/index.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';
import { galleryCtr } from '#modules/gallery/index.js';
import { userCtr } from '#modules/user/user.controller.js';
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
    E_NotificationEntityType,
    E_NotificationStatus,
    E_NotificationType,
} from './notification.type.js';
import { deriveRedirect, safeRedirect } from './notification.util.js';

const mongooseCtr = new MongooseController<I_Notification>(NotificationModel);

interface NotificationData {
    mediaType?: 'image' | 'video';
    videoEmbedUrl?: string;
    [k: string]: unknown;
}

// Whitelist CDN để nhận thumbnailUrl từ hint một cách an toàn
function isTrustedCdn(u?: string): boolean {
    try {
        const host = new URL(String(u)).hostname;
        return ['cdn.yourdomain.com', 'media.bunnycdn.com'].includes(host);
    }
    catch {
        return false;
    }
}

export async function buildPresentation(
    context: I_Context,
    notification: I_Notification,
    presentationHint?: I_NotificationPresentation,
): Promise<I_NotificationPresentation> {
    const presentation: I_NotificationPresentation = {};

    // actor snapshot
    // actor snapshot
    if (notification.actorId) {
        const actorFound = await userCtr.getUser(context, { filter: { id: notification.actorId } });
        if (actorFound.success) {
            const actor = actorFound.result;

            const rawUrls: Array<string | undefined> = [
                actor.partner1?.gallery?.url,
                actor.partner2?.gallery?.url,
            ];

            const avatarUrls: string[] = [];
            for (const u of rawUrls) {
                if (!u)
                    continue;
                try {
                    avatarUrls.push(
                        bunnyCtr.generateSignedUrl({
                            fullUrl: u,
                            extraQueryParams: { class: 'normal' },
                        }),
                    );
                }
                catch { /* ignore */ }
            }

            presentation.actor = {
                displayName: actor.displayName,
                accountType: actor.accountType,
                avatarUrls: avatarUrls.length ? avatarUrls : undefined,
            };
        }
    }

    // thumbnail (ưu tiên hint nếu hợp lệ, nếu không derive từ gallery)
    let thumbnailUrl: string | undefined;
    try {
        if (presentationHint?.thumbnailUrl && isTrustedCdn(presentationHint.thumbnailUrl)) {
            thumbnailUrl = presentationHint.thumbnailUrl;
        }
        else if (notification.entityType === E_NotificationEntityType.MEDIA && notification.entityId) {
            const galleryFound = await galleryCtr.getGallery(context, { filter: { id: notification.entityId } });
            if (galleryFound.success && galleryFound.result.url) {
                const dataObj = (notification.data ??= {}) as NotificationData;
                if (galleryFound.result.type === E_GalleryType.IMAGE) {
                    thumbnailUrl = bunnyCtr.generateSignedUrl({
                        fullUrl: galleryFound.result.url,
                        extraQueryParams: { class: 'normal' },
                    });
                    dataObj.mediaType = 'image';
                }
                else if (galleryFound.result.type === E_GalleryType.VIDEO) {
                    // Chuông chỉ dùng thumbnail/poster đã ký — không iframe
                    thumbnailUrl = bunnyCtr.generateSignedUrl({
                        fullUrl: galleryFound.result.url,
                        extraQueryParams: { class: 'free' },
                    });
                    dataObj.mediaType = 'video';
                }
            }
        }
    }
    catch {
    /* ignore */
    }

    if (thumbnailUrl) {
        presentation.thumbnailUrl = thumbnailUrl;
    }

    // redirect: ưu tiên override an toàn, nếu không derive
    presentation.redirect = safeRedirect(presentationHint?.redirect) ?? deriveRedirect(notification);

    // headline
    if (notification.title) {
        presentation.headline = notification.title;
    }

    return presentation;
}

function hasInApp(n: I_Notification): boolean {
    return Array.isArray(n.channels) && n.channels.includes(E_NotificationChannel.IN_APP);
}

export const notificationCtr = {
    getNotification: async (
        _context: I_Context,
        { filter, projection, options }: I_Input_FindOne<I_Input_QueryNotification>,
    ): Promise<I_Return<I_Notification>> => {
        return mongooseCtr.findOne(filter, projection, options);
    },

    getNotifications: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryNotification>,
    ): Promise<I_Return<T_PaginateResult<I_Notification>>> => {
        return mongooseCtr.findPaging(filter, options);
    },

    createNotification: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        const { targetId, type, entityType, entityId, presentation: presentationHint } = doc;

        if (!targetId)
            throwError({ message: 'targetId is required', status: RESPONSE_STATUS.BAD_REQUEST });
        if (!type)
            throwError({ message: 'Notification type is required', status: RESPONSE_STATUS.BAD_REQUEST });
        if (entityType && !entityId) {
            throwError({
                message: 'entityId is required when entityType is provided',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const channels
      = doc.channels && doc.channels.length > 0 ? doc.channels : [E_NotificationChannel.EMAIL];

        const { presentation: _drop, ...docToPersist } = { ...doc, channels };

        const result = await mongooseCtr.createOne({
            ...docToPersist,
            status: E_NotificationStatus.QUEUED,
        });

        if (result.success && hasInApp(result.result)) {
            try {
                const presentation = await buildPresentation(context, result.result, presentationHint);
                const payload: I_NotificationAddedPayload = {
                    notification: result.result,
                    presentation,
                };
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, payload);
            }
            catch {
                const payload: I_NotificationAddedPayload = { notification: result.result };
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, payload);
            }
        }

        return result;
    },

    createNotificationWithSettings: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        const { targetId, type, entityType, entityId } = doc;

        if (!targetId)
            throwError({ message: 'targetId is required', status: RESPONSE_STATUS.BAD_REQUEST });
        if (!type)
            throwError({ message: 'Notification type is required', status: RESPONSE_STATUS.BAD_REQUEST });
        if (entityType && !entityId) {
            throwError({ message: 'entityId is required when entityType is provided', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        // 1) Giữ nguyên ngữ cảnh input (không mutate)
        const contextDoc: Readonly<I_Input_CreateNotification> = Object.freeze({ ...doc });

        // 2) Lấy settings user
        const userFound = await userCtr.getUser(context, { filter: { id: targetId } });
        if (!userFound.success) {
            throwError({ message: 'Target user not found', status: RESPONSE_STATUS.NOT_FOUND });
        }
        const s = userFound.result.settings?.notification ?? {};

        // 3) Quyết định channels theo type + toggle (user sở hữu quyền email)
        let channels: E_NotificationChannel[] = [E_NotificationChannel.IN_APP];
        switch (type) {
            case E_NotificationType.MEDIA_LIKED:
            case E_NotificationType.FOLLOWED_PROFILE_POSTED_MEDIA:
            case E_NotificationType.GUESTBOOK_POST:
            case E_NotificationType.PROFILE_VISIT:
                break; // in-app only
            case E_NotificationType.NEW_FOLLOWER:
                if (s.gainFollower)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_MESSAGE:
                if (s.receiveMessage)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST:
                if (s.newMemberJoined)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED:
                if (s.followingPostAnnouncement)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_BLOG_POST:
            case E_NotificationType.NEW_PODCAST:
                channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.RECEIPT_EMAIL_ONLY:
            case E_NotificationType.PAYMENT_ISSUE:
                channels = [E_NotificationChannel.EMAIL]; // email bắt buộc
                break;
            default:
                channels.push(E_NotificationChannel.EMAIL);
        }

        // 4) Lọc doc để persist (không cho caller override channels/isEmailSuppressed/presentation)
        const {
            presentation: _dropPresentation,
            channels: _dropChannels,
            isEmailSuppressed: _dropSuppressed,
            ...persistBase
        } = contextDoc;

        const result = await mongooseCtr.createOne({
            ...persistBase,
            channels,
            status: E_NotificationStatus.QUEUED,
            isEmailSuppressed: false,
        });

        if (result.success) {
            // 5) Publish IN_APP
            if (result.result.channels?.includes(E_NotificationChannel.IN_APP)) {
                try {
                    const presentation = await buildPresentation(context, result.result, contextDoc.presentation);
                    const payload: I_NotificationAddedPayload = { notification: result.result, presentation };
                    pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, payload);
                }
                catch {
                    const payload: I_NotificationAddedPayload = { notification: result.result };
                    pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, payload);
                }
            }

            // 6) Email (nếu được phép) — giữ contextDoc để render template
            if (result.result.channels?.includes(E_NotificationChannel.EMAIL)) {
                // await mailer.enqueueNotificationEmail({
                //   notification: result.result,
                //   contextDoc, // giữ ngữ cảnh gốc: title/body/data/... để templating
                //   user: userFound.result,
                // });
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
        _context: I_Context,
        { filter }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        if (!filter) {
            throwError({ message: 'Filter is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const result = await mongooseCtr.updateOne(
            { filter:
            {
                status: E_NotificationStatus.READ,
                readAt: new Date(),
            } },
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
        _context: I_Context,
        { filter }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        if (!filter) {
            throwError({ message: 'Filter is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const result = await mongooseCtr.updateOne(
            { filter: {
                status: E_NotificationStatus.DISMISSED,
                dismissedAt: new Date(),
            } },
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
            async (payload, _vars, context) => {
                const currentUserId = context?.req?.session?.user?.id;
                return !!currentUserId && payload?.notification.targetId === currentUserId;
            },
        ),

    subscribeToNotificationUpdated: () =>
        withFilter<I_NotificationUpdatedPayload, { userId?: string }, I_WsContext>(
            () => pubsub.asyncIterableIterator([E_NOTIFICATION_EVENTS.NOTIFICATION_UPDATED]),
            async (payload, _vars, context) => {
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
