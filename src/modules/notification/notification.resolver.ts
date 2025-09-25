import type {
    I_Input_CreateOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Input_CreateNotification,
    I_Input_QueryNotification,
    I_Input_UpdateNotification,
    I_NotificationAddedPayload,
    I_NotificationDeletedPayload,
    I_NotificationReadPayload,
    I_NotificationUpdatedPayload,
} from './notification.type.js';

import { notificationCtr } from './notification.controller.js';

const notificationResolver = {
    Query: {
        getNotification: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryNotification>, context: I_Context) => notificationCtr.getNotification(context, args),
        getNotifications: (
            _parent: unknown,
            args: I_Input_FindPaging<I_Input_QueryNotification>,
            context: I_Context,
        ) => notificationCtr.getNotifications(context, args),
        getNotificationCounters: (_parent: unknown, _args: unknown, context: I_Context) =>
            notificationCtr.getNotificationCounters(context),
    },
    Mutation: {
        createNotification: (
            _parent: unknown,
            args: I_Input_CreateOne<I_Input_CreateNotification>,
            context: I_Context,
        ) => notificationCtr.createNotification(context, args),
        createNotificationWithSettings: (
            _parent: unknown,
            args: I_Input_CreateOne<I_Input_CreateNotification>,
            context: I_Context,
        ) => notificationCtr.createNotificationWithSettings(context, args),
        updateNotification: (
            _parent: unknown,
            args: I_Input_UpdateOne<I_Input_UpdateNotification>,
            context: I_Context,
        ) => notificationCtr.updateNotification(context, args),
        deleteNotification: (
            _parent: unknown,
            args: I_Input_UpdateOne<I_Input_UpdateNotification>,
            context: I_Context,
        ) => notificationCtr.deleteNotification(context, args),
        markNotificationRead: (
            _parent: unknown,
            args: I_Input_UpdateOne<I_Input_UpdateNotification>,
            context: I_Context,
        ) => notificationCtr.markNotificationRead(context, args),
    },
    Subscription: {
        notificationAdded: {
            subscribe: () => notificationCtr.subscribeToNotificationAdded(),
            resolve: (payload: I_NotificationAddedPayload) => payload.notification,
        },
        notificationUpdated: {
            subscribe: () => notificationCtr.subscribeToNotificationUpdated(),
            resolve: (payload: I_NotificationUpdatedPayload) => payload.notification,
        },
        notificationRead: {
            subscribe: () => notificationCtr.subscribeToNotificationRead(),
            resolve: (payload: I_NotificationReadPayload) => payload,
        },
        notificationDeleted: {
            subscribe: () => notificationCtr.subscribeToNotificationDeleted(),
            resolve: (payload: I_NotificationDeletedPayload) => payload,
        },
    },

};

export default notificationResolver;
