import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

import type { I_Conversation } from '../conversation.type.js';

export interface I_Message_PayLoad {
    conversationId?: string;
    conversation?: I_Conversation;
    senderId?: string;
    sender?: I_User;
    content?: string;
    parentId?: string;
    parent?: I_Message;
}

export interface I_Message extends I_Message_PayLoad, I_GenericDocument { }

export interface I_QueryConversation extends I_Message { }

export interface I_MutateConversation extends Omit<I_Message, 'id' | ' createdAt' | 'updatedAt' | 'conversation' | 'sender' | 'parent'> { }
