import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_Role_User } from '#modules/authz/role/index.js';
import type { I_Blog } from '#modules/blog/index.js';
import type { I_Destination } from '#modules/destination/index.js';
import type { I_User } from '#modules/user/index.js';

import type { I_Message, I_MessageContent } from '../message/message.type.js';
import type { I_Participant } from '../participant/participant.type.js';

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

export interface I_Conversation extends I_GenericDocument {
    type?: E_ConversationType;
    name?: string;
    createdById?: string;
    createdBy?: I_User;
    lastMessageId?: string;
    lastMessage?: I_Message;
    entityId?: string;
    entity?: I_Blog | I_Destination | I_User;
    participants?: I_Participant[];
    retentionDays?: number;
    lastMessageAt?: Date;
}

export interface I_BroadcastResult {
    messageId: string;
    recipientCount: number;
}

export type T_Conversation_Populate = 'createdBy' | 'lastMessage';

export interface I_Input_QueryConversation extends Omit<I_Conversation, T_Conversation_Populate> { }

export interface I_Input_CreateConversation extends Omit<I_Conversation, T_Omit_Create | T_Conversation_Populate> {
    type: E_ConversationType;
    createdById: string;
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
