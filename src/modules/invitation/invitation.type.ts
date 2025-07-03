import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

export enum E_InvitationType {
    EVENT = 'EVENT',
    CONVERSATION = 'CONVERSATION',
}

export enum E_InvitationStatus {
    PENDING = 'PENDING',
    ACCEPTED = 'ACCEPTED',
    REJECTED = 'REJECTED',
    BLACKLISTED = 'BLACKLISTED',
}

export interface I_Invitation extends I_GenericDocument {
    type?: E_InvitationType;
    userId?: string;
    user?: I_User;
    inviteId?: string;
    invite?: I_User;
    status?: E_InvitationStatus;
}

export type T_Invitation_Populate = 'user' | 'invite';

export interface I_Input_QueryInvitation extends Omit<I_Invitation, T_Invitation_Populate> { }

export interface I_Input_CreateInvitation extends Omit<I_Invitation, T_Omit_Create | T_Invitation_Populate> {
    type: E_InvitationType;
    userId: string;
    inviteId: string;
}

export interface I_Input_UpdateInvitation extends Omit<I_Invitation, T_Omit_Update | T_Invitation_Populate> { }
