import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_NotificationType {
    MEDIA_LIKED = 'MEDIA_LIKED',
    NEW_FOLLOWER = 'NEW_FOLLOWER',
    NEW_MESSAGE = 'NEW_MESSAGE',
    NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST = 'NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST',
    NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED = 'NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED',
    FOLLOWED_PROFILE_POSTED_MEDIA = 'FOLLOWED_PROFILE_POSTED_MEDIA',
    NEW_BLOG_POST = 'NEW_BLOG_POST',
    NEW_PODCAST = 'NEW_PODCAST',
    RECEIPT_EMAIL_ONLY = 'RECEIPT_EMAIL_ONLY',
    PAYMENT_ISSUE = 'PAYMENT_ISSUE',
    GUESTBOOK_POST = 'GUESTBOOK_POST',
    PROFILE_VISIT = 'PROFILE_VISIT',
}

export enum E_NotificationChannel {
    IN_APP = 'IN_APP',
    EMAIL = 'EMAIL',
}

export enum E_NotificationAction {
    ADDED = 'ADDED',
    UPDATED = 'UPDATED',
    READ = 'READ',
    DISMISSED = 'DISMISSED',
    DELETED = 'DELETED',
}

export enum E_NotificationStatus {
    QUEUED = 'QUEUED',
    SENT = 'SENT',
    READ = 'READ',
    DISMISSED = 'DISMISSED',
    FAILED = 'FAILED',
}

export enum E_NotificationEntityType {
    USER = 'USER',
    MEDIA = 'MEDIA',
    ANNOUNCEMENT = 'ANNOUNCEMENT',
    BLOG = 'BLOG',
    PODCAST = 'PODCAST',
    MESSAGE_THREAD = 'MESSAGE_THREAD',
    GUESTBOOK_ENTRY = 'GUESTBOOK_ENTRY',
    PAYMENT = 'PAYMENT',
    EVENT = 'EVENT',
    DESTINATION = 'DESTINATION',
    CONVERSATION = 'CONVERSATION',
}

// 🔹 Notification Subscription Events
export enum E_NOTIFICATION_EVENTS {
    NOTIFICATION_ADDED = 'NOTIFICATION_ADDED',
    NOTIFICATION_UPDATED = 'NOTIFICATION_UPDATED',
    NOTIFICATION_READ = 'NOTIFICATION_READ',
    NOTIFICATION_DISMISSED = 'NOTIFICATION_DISMISSED',
    NOTIFICATION_DELETED = 'NOTIFICATION_DELETED',
}

export enum E_RedicrectType {
    PROFILE = 'PROFILE',
    MEDIA = 'MEDIA',
    BLOG = 'BLOG',
    PODCAST = 'PODCAST',
    MESSAGE_THREAD = 'MESSAGE_THREAD',
    GUESTBOOK_ENTRY = 'GUESTBOOK_ENTRY',
    PAYMENT = 'PAYMENT',
    EVENT = 'EVENT',
    DESTINATION = 'DESTINATION',
    CONVERSATION = 'CONVERSATION',
}

export interface I_NotificationPresentation {
    id?: string;
    actor?: {
        displayName?: string;
        accountType?: string;
        avatarUrls?: string[];
    };
    thumbnailUrl?: string;
    redirect?: {
        kind?: E_RedicrectType;
        id?: string;
    };
    headline?: string;
}

export interface I_Notification extends I_GenericDocument {
    type?: E_NotificationType;
    actorId?: string; // Ai gây ra noti
    targetId?: string; // Ai nhận noti
    entityType?: E_NotificationEntityType;
    entityId?: string;
    title?: string;
    body?: string;
    data?: any;
    presentation?: I_NotificationPresentation;
    channels?: E_NotificationChannel[];
    status?: E_NotificationStatus;
    scheduledAt?: Date;
    readAt?: Date;
    dismissedAt?: Date;
    isEmailSuppressed?: boolean;
}

export type T_Notification_Populate = never;

export interface I_Input_QueryNotification extends Omit<I_Notification, T_Notification_Populate> {}

export interface I_Input_CreateNotification extends Omit<I_Notification, T_Omit_Create | T_Notification_Populate> {}

export interface I_Input_UpdateNotification extends Omit<I_Notification, T_Omit_Update | T_Notification_Populate> {}

export interface I_NotificationAddedPayload {
    notification: I_Notification;
    presentation?: I_Notification['presentation'];
}

export interface I_NotificationUpdatedPayload {
    notification: I_Notification;
}

export interface I_NotificationReadPayload {
    notificationId: string;
    readAt: Date;
    targetId: string;
}

export interface I_NotificationDismissedPayload {
    notificationId: string;
    targetId: string;
    dismissedAt: Date;
}

export interface I_NotificationDeletedPayload {
    notificationId: string;
    targetId: string;
}

export interface I_NotificationEventPayload {
    notificationEvent: {
        notificationId: string;
        type: E_NotificationType;
        action: E_NotificationAction;
        notification?: I_Notification;
    };
}

export interface I_NotificationSubscriptionFilter {
    targetId?: string; // User ID nhận noti
    type?: E_NotificationType; // Lọc theo loại noti (optional)
}
