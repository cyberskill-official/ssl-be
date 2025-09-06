import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

import type { I_Conversation } from '../conversation/index.js';
import type { I_MessageStatus } from '../message-status/index.js';

export enum E_MessageType {
    TEXT = 'TEXT',
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export interface I_MessageContent {
    type: E_MessageType;
    value: string;
}

export interface I_Message extends I_GenericDocument {
    senderId?: string;
    sender?: I_User;
    content?: I_MessageContent;
    recipientId?: string;
    conversationId?: string;
    conversation?: I_Conversation;
    parentId?: string;
    parent?: I_Message;
    messageStatuses?: I_MessageStatus[];
    deletedAt?: Date;
    redacted?: boolean;
    expiresAt?: Date;
}

export type T_Message_Populate = 'sender' | 'conversation' | 'parent' | 'messageStatuses';

export interface I_Input_QueryMessage extends Omit<I_Message, T_Message_Populate> { }

export interface I_Input_CreateMessage extends Omit<I_Message, T_Omit_Create | T_Message_Populate> {
    content: I_MessageContent;
    recipientId?: string;
    conversationId?: string;
    parentId?: string;
}

export interface I_Input_UpdateMessage extends Omit<I_Message, T_Omit_Update | T_Message_Populate> { }
