import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_ConversationType } from '#modules/conversation/index.js';
import type { E_EventType } from '#modules/event/index.js';
import type { E_LocationEntityType, I_Map } from '#modules/location/index.js';
import type { E_AccountType, E_Gender } from '#modules/user/user.type.js';

export enum E_NotificationType {
    MEDIA_LIKED = 'MEDIA_LIKED',
    NEW_FOLLOWER = 'NEW_FOLLOWER',
    MODERATION_MEDIA_REJECTED = 'MODERATION_MEDIA_REJECTED',
    GROUP_JOIN_REQUEST = 'GROUP_JOIN_REQUEST',
    GROUP_JOIN_APPROVED = 'GROUP_JOIN_APPROVED',
    GROUP_MEMBER_JOINED = 'GROUP_MEMBER_JOINED',
    NEW_MESSAGE = 'NEW_MESSAGE',
    CONVERSATION_INVITATION = 'CONVERSATION_INVITATION',
    EVENT_PARTICIPATION_ACCEPTED = 'EVENT_PARTICIPATION_ACCEPTED',
    NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST = 'NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST',
    NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED = 'NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED',
    FOLLOWED_PROFILE_POSTED_MEDIA = 'FOLLOWED_PROFILE_POSTED_MEDIA',
    NEW_BLOG_POST = 'NEW_BLOG_POST',
    NEW_PODCAST = 'NEW_PODCAST',
    RECEIPT_EMAIL_ONLY = 'RECEIPT_EMAIL_ONLY',
    PAYMENT_ISSUE = 'PAYMENT_ISSUE',
    GUESTBOOK_POST = 'GUESTBOOK_POST',
    PROFILE_VISIT = 'PROFILE_VISIT',
    AGE_VERIFICATION_APPROVED = 'AGE_VERIFICATION_APPROVED',
}

export const OTHER_TYPES = [
    E_NotificationType.NEW_FOLLOWER,
    E_NotificationType.CONVERSATION_INVITATION,
    E_NotificationType.EVENT_PARTICIPATION_ACCEPTED,
    E_NotificationType.NEW_MEMBER_IN_YOUR_AREA_OF_INTEREST,
    E_NotificationType.NEW_ANNOUNCEMENT_IN_INTEREST_AREA_OR_FOLLOWED,
    E_NotificationType.PAYMENT_ISSUE,
    E_NotificationType.RECEIPT_EMAIL_ONLY,
    E_NotificationType.MEDIA_LIKED,
    E_NotificationType.MODERATION_MEDIA_REJECTED,
    E_NotificationType.GROUP_JOIN_REQUEST,
    E_NotificationType.GROUP_JOIN_APPROVED,
    E_NotificationType.GROUP_MEMBER_JOINED,
    E_NotificationType.FOLLOWED_PROFILE_POSTED_MEDIA,
    E_NotificationType.NEW_BLOG_POST,
    E_NotificationType.NEW_PODCAST,
    E_NotificationType.GUESTBOOK_POST,
    E_NotificationType.PROFILE_VISIT,
    E_NotificationType.AGE_VERIFICATION_APPROVED,
];

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

export enum E_NOTIFICATION_EVENTS {
    NOTIFICATION_ADDED = 'NOTIFICATION_ADDED',
    NOTIFICATION_UPDATED = 'NOTIFICATION_UPDATED',
    NOTIFICATION_READ = 'NOTIFICATION_READ',
    NOTIFICATION_DISMISSED = 'NOTIFICATION_DISMISSED',
    NOTIFICATION_DELETED = 'NOTIFICATION_DELETED',
}

export enum E_RedirectType {
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

export interface T_NotificationPresentationActor {
    username?: string;
    accountType?: E_AccountType;
    avatarUrl?: string;
    gender?: E_Gender;
}

export interface I_NotificationRedirect {
    kind?: E_RedirectType;
    id?: string;
    url?: string;
    map?: I_Map;
    eventType?: E_EventType;
    commentId?: string;
    locationId?: string;
    entityId?: string;
    entityType?: E_LocationEntityType;
}

export interface I_NotificationContext {
    conversationType?: E_ConversationType;
    groupName?: string;
    isOpenComment?: boolean;
    parentMessageId?: string;
    profileOwnerId?: string;
    participantCount?: number;
    profileOwnerUsername?: string;
    mediaId?: string;
    mediaType?: string;
    galleryType?: string;
    isVideo?: boolean;
}

export interface I_NotificationPresentation {
    id?: string;
    actor?: T_NotificationPresentationActor;
    thumbnailUrl?: string;
    redirect?: I_NotificationRedirect;
    headline?: string;
    context?: I_NotificationContext;
}

export interface I_Notification extends I_GenericDocument {
    type?: E_NotificationType[];
    actorId?: string; // Ai gây ra noti
    targetId?: string; // Ai nhận noti
    entityType?: E_NotificationEntityType;
    entityId?: string;
    body?: string;
    // data?: any;
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

export interface I_Input_CreateNotification extends Omit<I_Notification, T_Omit_Create | T_Notification_Populate> {
    type?: E_NotificationType[];
}

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
