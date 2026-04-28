import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

import type { I_Message } from '../message/index.js';

export interface I_MessageStatus extends I_GenericDocument {
    messageId?: string;
    message?: I_Message;
    userId?: string;
    user?: I_User;
    readAt?: Date;
}

export type T_MessageStatus_Populate = 'message' | 'user';

export interface I_Input_QueryMessageStatus extends Omit<I_MessageStatus, T_MessageStatus_Populate> { }

export interface I_Input_CreateMessageStatus extends Omit<I_MessageStatus, T_Omit_Create | T_MessageStatus_Populate> {
    messageId: string;
    userId: string;
}

export interface I_Input_UpdateMessageStatus extends Omit<I_MessageStatus, T_Omit_Update | T_MessageStatus_Populate> { }
