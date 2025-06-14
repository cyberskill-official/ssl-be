import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

import type { I_Message } from '../message/message.type.js';

export interface I_MessageStatus_PayLoad {
    messageId?: string;
    message?: I_Message;
    userId?: string;
    user?: I_User;
    deliveredAt?: Date;
    readAt?: Date;
}

export interface I_MessageStatus extends I_MessageStatus_PayLoad, I_GenericDocument { }

export interface I_QueryConversation extends I_MessageStatus { }

export interface I_MutateConversation extends Omit<I_MessageStatus, 'id' | 'createdAt' | 'updatedAt' | 'message' | 'user'> { }
