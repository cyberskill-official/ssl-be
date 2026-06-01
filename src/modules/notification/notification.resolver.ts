import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
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
    I_NotificationDismissedPayload,
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
        getNotificationCounters: (_parent: unknown, _agrs: unknown, context: I_Context) => notificationCtr.getNotificationCounters(context),
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
            args: I_Input_DeleteOne<I_Input_QueryNotification>,
            context: I_Context,
        ) => notificationCtr.deleteNotification(context, args),
        deleteNotifications: (
            _parent: unknown,
            args: I_Input_DeleteOne<I_Input_QueryNotification>,
            context: I_Context,
        ) => notificationCtr.deleteNotifications(context, args),
        markNotificationRead: (
            _parent: unknown,
            args: I_Input_UpdateOne<I_Input_UpdateNotification>,
            context: I_Context,
        ) => notificationCtr.markNotificationRead(context, args),
    },
    Subscription: {
        notificationAdded: {
            subscribe: (parent: any, args: any, context: any, info: any) => notificationCtr.subscribeToNotificationAdded()(parent, args, context, info),
            resolve: (payload: I_NotificationAddedPayload) => payload.notification,
        },
        notificationUpdated: {
            subscribe: (parent: any, args: any, context: any, info: any) => notificationCtr.subscribeToNotificationUpdated()(parent, args, context, info),
            resolve: (payload: I_NotificationUpdatedPayload) => payload.notification,
        },
        notificationRead: {
            subscribe: (parent: any, args: any, context: any, info: any) => notificationCtr.subscribeToNotificationRead()(parent, args, context, info),
            resolve: (payload: I_NotificationReadPayload) => payload,
        },
        notificationDismissed: {
            subscribe: (parent: any, args: any, context: any, info: any) => notificationCtr.subscribeToNotificationDismissed()(parent, args, context, info),
            resolve: (payload: I_NotificationDismissedPayload) => payload,
        },
        notificationDeleted: {
            subscribe: (parent: any, args: any, context: any, info: any) => notificationCtr.subscribeToNotificationDeleted()(parent, args, context, info),
            resolve: (payload: I_NotificationDeletedPayload) => payload,
        },
    },

};

export default notificationResolver;
