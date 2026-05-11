import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Conversation } from '#modules/conversation/conversation/index.js';
import type { I_Event } from '#modules/event/index.js';
import type { I_User } from '#modules/user/index.js';

export enum E_InvitationEvent {
    INVITATION_SENT = 'INVITATION_SENT',
    INVITATION_RESPONDED = 'INVITATION_RESPONDED',
}

export enum E_InvitationType {
    EVENT = 'EVENT',
    CONVERSATION = 'CONVERSATION',
}

export enum E_InvitationStatus {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    BLACKLISTED = 'BLACKLISTED',
    DELETED = 'DELETED',
}

export interface I_Invitation extends I_GenericDocument {
    type?: E_InvitationType;
    userId?: string;
    user?: I_User;
    inviterId?: string;
    inviter?: I_User;
    status?: E_InvitationStatus;
    entityId?: string;
    entity?: I_Event | I_Conversation;
}

export type T_Invitation_Populate = 'user' | 'inviter' | 'conversation';

export interface I_Input_QueryInvitation extends Omit<I_Invitation, T_Invitation_Populate> { }

export interface I_Input_CreateInvitation extends Omit<I_Invitation, T_Omit_Create | T_Invitation_Populate> {
    type: E_InvitationType;
    userId: string;
    entityId: string;
    status?: E_InvitationStatus;
}

export interface I_Input_UpdateInvitation extends Omit<I_Invitation, T_Omit_Update | T_Invitation_Populate> { }

export interface I_Input_RespondToInvitation {
    invitationId: string;
    status: E_InvitationStatus;
}

// Subscription types
export interface I_InvitationEventPayload {
    invitation: I_Invitation;
    eventType: E_InvitationEvent;
}

export interface I_InvitationSubscriptionFilter {
    entityId?: string;
    type: E_InvitationType;
}
