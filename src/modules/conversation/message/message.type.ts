import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

import type { I_Conversation } from '../conversation/index.js';

export interface I_Message extends I_GenericDocument {
    senderId?: string;
    sender?: I_User;
    content?: string;
    conversationId?: string;
    conversation?: I_Conversation;
    parentId?: string;
    parent?: I_Message;
}

export type T_Message_Populate = 'sender' | 'conversation' | 'parent';

export interface I_Input_QueryMessage extends Omit<I_Message, T_Message_Populate> { }

export interface I_Input_CreateMessage extends Omit<I_Message, T_Omit_Create | T_Message_Populate> {
    senderId: string;
    content: string;
}

export interface I_Input_UpdateMessage extends Omit<I_Message, T_Omit_Update | T_Message_Populate> { }
