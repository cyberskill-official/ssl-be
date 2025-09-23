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

const mongooseCtr = new MongooseController<I_Notification>(NotificationModel);
export async function buildPresentation(context: I_Context, notification: I_Notification) {
    const presentation: Record<string, unknown> = {};

    // actor snapshot
    if (notification.actorId) {
        const actorFound = await userCtr.getUser(context, { filter: { id: notification.actorId } });
        if (actorFound.success) {
            const actor = actorFound.result;
            presentation['actor'] = {
                id: actor.id,
                displayName: actor.displayName,
                accountType: actor.accountType,
                avatarUrl: actor.partner1?.gallery?.url || actor.partner2?.gallery?.url || actor?.partner1?.gallery?.url || undefined,
            };
        }
    }

    let thumbnailUrl: string | undefined;
    try {
        if (notification.data && (notification.data as any).thumbnailUrl) {
            thumbnailUrl = (notification.data as any).thumbnailUrl as string;
        }
        else if (notification.entityType === E_NotificationEntityType.MEDIA && notification.entityId) {
            try {
                // dynamic import to avoid circular require
                const galleryFound = await galleryCtr.getGallery(context, { filter: { id: notification.entityId } });
                if (galleryFound.success && galleryFound.result.url) {
                    if (galleryFound.result.type === E_GalleryType.IMAGE) {
                        thumbnailUrl = bunnyCtr.generateSignedUrl({ fullUrl: galleryFound.result.url, extraQueryParams: { class: 'normal' } });
                    }
                    else if (galleryFound.result.type === E_GalleryType.VIDEO) {
                        thumbnailUrl = bunnyCtr.generateEmbedIframeUrlFromUrl({ fullUrl: galleryFound.result.url });
                    }
                }
            }
            catch {
                // ignore
            }
        }
    }
    catch {
        // ignore
    }

    if (thumbnailUrl) {
        presentation['thumbnailUrl'] = thumbnailUrl;
    }

    // include redirect verbatim for client
    if (notification.data && (notification.data as any).redirect) {
        presentation['redirect'] = (notification.data as any).redirect;
    }

    // include headline/title if present
    if (notification.title) {
        presentation['headline'] = notification.title;
    }

    return presentation;
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
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        const { targetId, type, entityType, entityId } = doc;
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

        if (!doc.channels || doc.channels.length === 0) {
            doc.channels = [E_NotificationChannel.EMAIL];
        }

        const result = await mongooseCtr.createOne({
            ...doc,
            status: E_NotificationStatus.QUEUED,
        });

        if (result.success) {
            // build presentation for UI convenience
            try {
                const presentation = await buildPresentation(_context, result.result);
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, {
                    notification: result.result,
                    presentation,
                } as unknown as I_NotificationAddedPayload);
            }
            catch {
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, {
                    notification: result.result,
                } as I_NotificationAddedPayload);
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
            throwError({
                message: 'entityId is required when entityType is provided',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        // Lấy user settings
        const userFound = await userCtr.getUser(context, { filter: { id: targetId } });
        if (!userFound.success) {
            throwError({ message: 'Target user not found', status: RESPONSE_STATUS.NOT_FOUND });
        }
        const settings = userFound.result.settings?.notification ?? {};

        // Xác định channels dựa vào type + toggle
        const channels: E_NotificationChannel[] = [E_NotificationChannel.IN_APP];
        const isEmailSuppressed = false;

        switch (type) {
            // Theo settings
            case E_NotificationType.NEW_FOLLOWER:
                if (settings.gainFollower)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_MESSAGE:
                if (settings.receiveMessage)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST:
                if (settings.newMemberJoined)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED:
                if (settings.followingPostAnnouncement)
                    channels.push(E_NotificationChannel.EMAIL);
                break;
            case E_NotificationType.NEW_BLOG_POST:
            case E_NotificationType.NEW_PODCAST:
                channels.push(E_NotificationChannel.EMAIL); // có thể toggle sau
                break;

            case E_NotificationType.MEDIA_LIKED:
            case E_NotificationType.FOLLOWED_PROFILE_POSTED_MEDIA:
            case E_NotificationType.GUESTBOOK_POST:
            case E_NotificationType.PROFILE_VISIT:
                // chỉ in-app, không thêm email
                break;

            case E_NotificationType.RECEIPT_EMAIL_ONLY:
            case E_NotificationType.PAYMENT_ISSUE:
                channels.length = 0; // clear in-app
                channels.push(E_NotificationChannel.EMAIL);
                break;

            default:
                // fallback
                channels.push(E_NotificationChannel.EMAIL);
        }

        const result = await mongooseCtr.createOne({
            ...doc,
            channels,
            status: E_NotificationStatus.QUEUED,
            isEmailSuppressed,
        });

        if (result.success) {
            try {
                const presentation = await buildPresentation(context, result.result);
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, {
                    notification: result.result,
                    presentation,
                } as unknown as I_NotificationAddedPayload);
            }
            catch {
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, {
                    notification: result.result,
                } as I_NotificationAddedPayload);
            }
        }

        return result;
    },
    updateNotification: async (
        _context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        const result = await mongooseCtr.updateOne(filter, update, options);

        if (result.success) {
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_UPDATED, {
                notification: result.result,
            } as I_NotificationUpdatedPayload);
        }

        return result;
    },
    deleteNotification: async (
        _context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryNotification>,
    ): Promise<I_Return<I_Notification>> => {
        const result = await mongooseCtr.deleteOne(filter, options);

        if (result.success) {
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_DELETED, {
                notificationId: filter.id,
                targetId: result.result.targetId!,
            } as I_NotificationDeletedPayload);
        }

        return result;
    },
    markNotificationRead: async (
        _context: I_Context,
        { filter }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        if (!filter)
            throwError({ message: 'Filter is required', status: RESPONSE_STATUS.BAD_REQUEST });

        const result = await mongooseCtr.updateOne(filter as never, {
            status: E_NotificationStatus.READ,
            readAt: new Date(),
        } as never);

        if (result.success) {
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_READ, {
                notificationId: result.result.id,
                targetId: result.result.targetId!,
                readAt: result.result.readAt!,
            } as I_NotificationReadPayload);
        }

        return result;
    },
    dismissNotification: async (
        _context: I_Context,
        { filter }: I_Input_UpdateOne<I_Input_UpdateNotification>,
    ): Promise<I_Return<I_Notification>> => {
        if (!filter)
            throwError({ message: 'Filter is required', status: RESPONSE_STATUS.BAD_REQUEST });

        const result = await mongooseCtr.updateOne(filter as never, {
            status: E_NotificationStatus.DISMISSED,
            dismissedAt: new Date(),
        } as never);

        if (result.success) {
            pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_DISMISSED, {
                notificationId: result.result.id,
                targetId: result.result.targetId!,
                dismissedAt: result.result.dismissedAt!,
            } as I_NotificationDismissedPayload);
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
