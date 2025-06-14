import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

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

export interface I_Invitation_PayLoad {
    type?: E_InvitationType;
    inviterId?: string;
    inviter?: I_User;
    inviteeId?: string;
    invitee?: I_User;
    status?: E_InvitationStatus;
}

export interface I_Invitation extends I_Invitation_PayLoad, I_GenericDocument { }

export interface I_Input_QueryInvitation extends I_Invitation { }

export interface I_Input_MutateInvitation extends Omit<I_Invitation, 'id' | 'createdAt' | 'updatedAt' | 'inviter' | 'invitee'> { }
