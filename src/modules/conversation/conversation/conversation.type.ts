import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

import type { I_Message } from '../message/message.type.js';

export enum E_ConversationType {
    PRIVATE = 'PRIVATE',
    GROUP = 'GROUP',
    PROFILE_COMMENT = 'PROFILE_COMMENT',
    BLOG_COMMENT = 'BLOG_COMMENT',
    DESTINATION_COMMENT = 'DESTINATION_COMMENT',
}

export interface I_Conversation extends I_GenericDocument {
    type?: E_ConversationType;
    name?: string;
    createdById?: string;
    createdBy?: I_User;
    lastMessageId?: string;
    lastMessage?: I_Message;
}

export type T_Conversation_Populate = 'createdBy' | 'lastMessage';

export interface I_Input_QueryConversation extends Omit<I_Conversation, T_Conversation_Populate> { }

export interface I_Input_CreateConversation extends Omit<I_Conversation, T_Omit_Create | T_Conversation_Populate> {
    type: E_ConversationType;
    createdById: string;
}

export interface I_Input_UpdateConversation extends Omit<I_Conversation, T_Omit_Update | T_Conversation_Populate> { }
