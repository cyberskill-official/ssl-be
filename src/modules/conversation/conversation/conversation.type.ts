import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_Role_User } from '#modules/authz/role/index.js';
import type { I_Blog } from '#modules/blog/index.js';
import type { I_Destination } from '#modules/destination/index.js';
import type { I_User } from '#modules/user/index.js';

import type { I_Message, I_MessageContent } from '../message/message.type.js';
import type { I_Participant } from '../participant/participant.type.js';

export enum E_ContactTopic {
    TECHNICAL_ACCOUNT = 'TECHNICAL_ACCOUNT',
    BILLING_MEMBERSHIP = 'BILLING_MEMBERSHIP',
    CONTENT_MODERATION = 'CONTENT_MODERATION',
    CLUB_EVENT = 'CLUB_EVENT',
    LEGAL_COMPLIANCE = 'LEGAL_COMPLIANCE',
    GENERAL_FEEDBACK = 'GENERAL_FEEDBACK',
}

export enum E_ContactTechnicalAccountType {
    LOGIN_OR_ACCESS_PROBLEM = 'LOGIN_OR_ACCESS_PROBLEM',
    PROFILE_VERIFICATION_ID_CHECK_UPLOADING = 'PROFILE_VERIFICATION_ID_CHECK_UPLOADING',
    PHOTO_OR_VIDEO_UPLOAD_ISSUES = 'PHOTO_OR_VIDEO_UPLOAD_ISSUES',
    TECHNICAL_BUG_OR_ERROR_ON_THE_SITE = 'TECHNICAL_BUG_OR_ERROR_ON_THE_SITE',
    OTHER = 'OTHER',
}

export enum E_ContactBillingMembershipType {
    MEMBERSHIP_UPGRADE_DOWGRADE = 'MEMBERSHIP_UPGRADE_DOWGRADE',
    SUBSCRIPTION_OR_PAYMENT_ISSUE = 'SUBSCRIPTION_OR_PAYMENT_ISSUE',
    BILLING_OR_REFUND_INQUIRY = 'BILLING_OR_REFUND_INQUIRY',
    PAYMENT_METHOD_OR_CARD_DECLINE = 'PAYMENT_METHOD_OR_CARD_DECLINE',
    PROMO_CODE_OR_DISCOUNT_PROBLEM = 'PROMO_CODE_OR_DISCOUNT_PROBLEM',
    OTHER = 'OTHER',
}

export enum E_ContactContentModerationType {
    REPORT_INAPPROPRIATE_CONTENT = 'REPORT_INAPPROPRIATE_CONTENT',
    REPORT_FAKE_OR_SUSPICIOUS_PROFILE = 'REPORT_FAKE_OR_SUSPICIOUS_PROFILE',
    REQUEST_CONTENT_REMOVAL = 'REQUEST_CONTENT_REMOVAL',
    QUESTIONS_ABOUT_AI_MODERATION_RULES = 'QUESTIONS_ABOUT_AI_MODERATION_RULES',
    OTHER = 'OTHER',
}

export enum E_ContactClubEventType {
    REPORT_EXPIRED_OR_INCORRECT_CLUB_INFORMATION = 'REPORT_EXPIRED_OR_INCORRECT_CLUB_INFORMATION',
    SUGGEST_A_NEW_CLUB_OR_RESORT = 'SUGGEST_A_NEW_CLUB_OR_RESORT',
    PROBLEMS_WITH_ANNOUNCEMENTS = 'PROBLEMS_WITH_ANNOUNCEMENTS',
    OTHER = 'OTHER',
}

export enum E_ContactLegalComplianceType {
    TERMS_OF_USE_PRIVACY_POLICY_QUESTIONS = 'TERMS_OF_USE_PRIVACY_POLICY_QUESTIONS',
    DATA_ACCESS_OR_DELETION_REQUEST_GDPR = 'DATA_ACCESS_OR_DELETION_REQUEST_GDPR',
    REPORT_HUMAN_TRAFFICKING_OR_NON_CONSENSUAL_ACTIVITY = 'REPORT_HUMAN_TRAFFICKING_OR_NON_CONSENSUAL_ACTIVITY',
    OTHER = 'OTHER',
}

export enum E_ContactGeneralFeedbackType {
    FEEDBACK_ON_DESIGN_OR_USABILITY = 'FEEDBACK_ON_DESIGN_OR_USABILITY',
    FEATURE_SUGGESTION = 'FEATURE_SUGGESTION',
    COLLABORATION_PARTNERSHIP_INQUIRY = 'COLLABORATION_PARTNERSHIP_INQUIRY',
    PRESS_OR_MEDIA_REQUEST = 'PRESS_OR_MEDIA_REQUEST',
}

export enum E_Device {
    DESKTOP = 'DESKTOP',
    MOBILE = 'MOBILE',
    TABLET = 'TABLET',
}

export enum E_ConversationType {
    PRIVATE = 'PRIVATE',
    GROUP = 'GROUP',
    PROFILE_COMMENT = 'PROFILE_COMMENT',
    BLOG_COMMENT = 'BLOG_COMMENT',
    DESTINATION_COMMENT = 'DESTINATION_COMMENT',
    ADMIN_BROADCAST = 'ADMIN_BROADCAST',
}

// Conversation Subscription Events
export enum E_CONVERSATION_EVENTS {
    // Message events
    MESSAGE_SENT = 'MESSAGE_SENT',

    // Conversation events
    CONVERSATION_CREATED = 'CONVERSATION_CREATED',
    CONVERSATION_UPDATED = 'CONVERSATION_UPDATED',
    CONVERSATION_DELETED = 'CONVERSATION_DELETED',

    // Participant events
    PARTICIPANT_JOINED = 'PARTICIPANT_JOINED',
    PARTICIPANT_LEFT = 'PARTICIPANT_LEFT',
    PARTICIPANT_ROLE_UPDATED = 'PARTICIPANT_ROLE_UPDATED',

    // Message status events
    MESSAGE_READ = 'MESSAGE_READ',
    MESSAGE_DELIVERED = 'MESSAGE_DELIVERED',

    // Typing events
    USER_TYPING = 'USER_TYPING',
    USER_STOPPED_TYPING = 'USER_STOPPED_TYPING',

    // Broadcast events
    ADMIN_BROADCAST = 'ADMIN_BROADCAST',
}

export enum E_ConversationAction {
    CREATED = 'CREATED',
    UPDATED = 'UPDATED',
    DELETED = 'DELETED',
}

export interface I_ConversationMeta {
    profileOwnerId?: string;
    destinationId?: string;
    destinationOwnerId?: string;
    contactTopic?: E_ContactTopic;
    contactEmail?: string;
    contactName?: string;
    contactSubject?: string;
    attachmentIds?: string[];
    extras?: Record<string, unknown>;
}

export interface I_Conversation extends I_GenericDocument {
    type?: E_ConversationType;
    name?: string;
    createdById?: string | null;
    createdBy?: I_User;
    lastMessageId?: string;
    lastMessage?: I_Message;
    entityId?: string;
    entity?: I_Blog | I_Destination | I_User;
    participants?: I_Participant[];
    retentionDays?: number;
    lastMessageAt?: Date;
    profileOwnerId?: string;
    ownerId?: string;
    meta?: Record<string, unknown>;
    contactAdmin?: I_ContactAdmin;
}

export interface I_BroadcastResult {
    messageId: string;
    recipientCount: number;
}

export type T_Conversation_Populate = 'createdBy' | 'lastMessage';

export interface I_Input_QueryConversation extends Omit<I_Conversation, T_Conversation_Populate> { }

export interface I_Input_CreateConversation extends Omit<I_Conversation, T_Omit_Create | T_Conversation_Populate> {
    type: E_ConversationType;
    createdById?: string | null;
    contactAdmin?: I_ContactAdmin;
}

export interface I_Input_CreateGroupConversation {
    name: string;
}

export interface I_Input_CreateBroadcast {
    content: I_MessageContent;
    target: E_Role_User;
}

export interface I_Input_UpdateConversation extends Omit<I_Conversation, T_Omit_Update | T_Conversation_Populate> { }

export interface I_Input_MarkAllMessagesAsRead {
    conversationId: string;
}

export interface I_Input_DeletePrivateConversation {
    conversationId: string;
}

export interface I_Input_DeleteGroupConversation {
    conversationId: string;
}

export interface I_ContactAdmin {
    topic: E_ContactTopic;
    username: string;
    email?: string;
    requestType?: E_ContactTechnicalAccountType | E_ContactBillingMembershipType | E_ContactContentModerationType | E_ContactClubEventType | E_ContactLegalComplianceType | E_ContactGeneralFeedbackType;
    device?: E_Device;
    message: string;
    image?: string;
    paymentDate?: Date;
    transactionId?: string;
    profileLink?: string;
    companyName?: string;
}

export interface I_Input_AdminReplyGuest {
    conversationId: string;
    email: string;
    topic: E_ContactTopic;
    requestType?: E_ContactTechnicalAccountType | E_ContactBillingMembershipType | E_ContactContentModerationType | E_ContactClubEventType | E_ContactLegalComplianceType | E_ContactGeneralFeedbackType;
    message: string;
}

export interface I_MessageSentPayload {
    conversation: I_Conversation;
}
export interface I_MessageReadPayload {
    messageRead: {
        messageId: string;
        userId: string;
        conversationId: string;
        readAt: Date;
    };
}

export interface I_ConversationEventPayload {
    conversationEvent: {
        conversationId: string;
        type: E_ConversationType.PRIVATE | E_ConversationType.GROUP;
        action: E_ConversationAction;
        // Có thể mở rộng thêm các trường cho các action khác:
        // conversation?: I_Conversation;  // cho CREATED/UPDATED
        // oldName?: string;             // cho UPDATED (rename)
        // newName?: string;             // cho UPDATED (rename)
    };
}

// Subscription filter types
export interface I_MessageSubscriptionFilter {
    conversationId?: string;
}

export interface I_ContactAdminResult {
    conversationId?: string;
}
