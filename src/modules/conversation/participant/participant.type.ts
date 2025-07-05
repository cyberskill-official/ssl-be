import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

import type { I_Conversation } from '../conversation/index.js';
import type { I_Message } from '../message/index.js';

export enum E_ParticipantRole {
    ADMIN = 'ADMIN',
    MEMBER = 'MEMBER',
}

export interface I_Participant extends I_GenericDocument {
    conversationId?: string;
    conversation?: I_Conversation;
    userId?: string;
    user?: I_User;
    lastReadMessageId?: string;
    lastReadMessage?: I_Message;
    role?: E_ParticipantRole;
}

export type T_Participant_Populate = 'conversation' | 'user' | 'lastReadMessage';

export interface I_Input_QueryParticipant extends Omit<I_Participant, T_Participant_Populate> { }

export interface I_Input_CreateParticipant extends Omit<I_Participant, T_Omit_Create | T_Participant_Populate> {
    conversationId: string;
    userId: string;
}

export interface I_Input_UpdateParticipant extends Omit<I_Participant, T_Omit_Update | T_Participant_Populate> {
}
