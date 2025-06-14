import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

import type { I_Message } from '../message/message.type.js';

export enum E_ParticipantRole {
    ADMIN = 'ADMIN',
    MEMBER = 'MEMBER',
}

export interface I_Participant_PayLoad {
    conversationId?: string;
    conversation?: I_Participant;
    lastReadMessageId?: string;
    lastReadMessage?: I_Message;
    userId?: string;
    user?: I_User;
    role?: E_ParticipantRole;
}

export interface I_Participant extends I_Participant_PayLoad, I_GenericDocument { }

export interface I_QueryConversation extends I_Participant { }

export interface I_MutateConversation extends Omit<I_Participant, 'id' | ' createdAt' | 'updatedAt' | 'conversation' | 'lastReadMessage' | 'user'> { }
