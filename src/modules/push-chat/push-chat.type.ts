import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

export enum E_PushChatAudience {
    ALL = 'ALL',
    MEMBERS = 'MEMBERS',
    NON_MEMBERS = 'NON_MEMBERS',
}

export interface I_PushChatMessage extends I_GenericDocument {
    content: string;
    targetAudience: E_PushChatAudience;
    sentById?: string;
    sentBy?: I_User;
    recipientCount?: number;
}

export type T_PushChatMessage_Populate = 'sentBy';

export interface I_Input_QueryPushChatMessage extends Omit<I_PushChatMessage, T_PushChatMessage_Populate> { }

export interface I_Input_CreatePushChatMessage extends Omit<I_PushChatMessage, T_Omit_Create | T_PushChatMessage_Populate | 'sentById' | 'recipientCount'> {
    content: string;
    targetAudience: E_PushChatAudience;
}

export interface I_Input_UpdatePushChatMessage extends Omit<I_PushChatMessage, T_Omit_Update | T_PushChatMessage_Populate | 'sentById'> { }

export interface I_SendPushChatResult {
    messageId: string;
    recipientCount: number;
    createdAt: Date;
}
