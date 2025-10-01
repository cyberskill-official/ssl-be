import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { withFilter } from 'graphql-subscriptions';

import type { I_Context, I_WsContext } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { messageStatusCtr } from '#modules/conversation/index.js';
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
import { hasInApp } from './notification.util.js';

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

        return mongooseCtr.findPaging(f, opts);
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

    createNotificationWithSettings: async (context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreateNotification>) => {
        const { targetId, entityType, entityId } = doc;
        const types: E_NotificationType[] = Array.isArray(doc.type) ? doc.type as E_NotificationType[] : (doc.type ? [doc.type as E_NotificationType] : []);

        if (!targetId) {
            throwError({ message: 'targetId is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (types.length === 0) {
            throwError({ message: 'Notification type is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (entityType && !entityId) {
            throwError({ message: 'entityId is required when entityType is provided', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const userFound = await userCtr.getUser(context, { filter: { id: targetId } });

        if (!userFound.success) {
            throwError({ message: 'Target user not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const s = userFound.result.settings?.notification ?? {};

        if (userFound.result.isDel === true) {
            return { success: true, message: null };
        }

        const has = (t: E_NotificationType) => types.includes(t);
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

            if (result.result.channels?.includes(E_NotificationChannel.IN_APP)) {
                const payload: I_NotificationAddedPayload = { notification: result.result, presentation: result.result.presentation };
                pubsub.publish(E_NOTIFICATION_EVENTS.NOTIFICATION_ADDED, payload);
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
