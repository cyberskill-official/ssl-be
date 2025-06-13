import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

import type { I_Message } from '../message/message.type.js';

export enum E_ConversationType {
    PRIVATE = 'PRIVATE',
    GROUP = 'GROUP',
    BLOG_COMMENT = 'BLOG_COMMENT',
    CLUB_COMMENT = 'CLUB_COMMENT',
}

export interface I_Conversation_PayLoad {
    type?: E_ConversationType;
    name?: string;
    createdById?: string;
    createdBy?: I_User;
    lastMessageId?: string;
    lastMessage?: I_Message;
}

export interface I_Conversation extends I_Conversation_PayLoad, I_GenericDocument { }

export interface I_QueryConversation extends I_Conversation { }

export interface I_MutateConversation extends Omit<I_Conversation, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'lastMessage'> { }
