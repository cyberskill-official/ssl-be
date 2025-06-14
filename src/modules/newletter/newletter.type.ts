import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export enum E_TargetAudience {
    PAID_MEMBERS_ONLY = 'PAID_MEMBERS_ONLY',
    FREE_MEMBERS_ONLY = 'FREE_MEMBERS_ONLY',
    CUSTOM_LIST = 'CUSTOM_LIST',
}

export enum E_SenderType {
    SEND_IMMEDIATELY = 'SEND_IMMEDIATELY',
    SCHEDULE_FOR_LATER = 'SCHEDULE_FOR_LATER',
}

export interface I_Newletter_PayLoad {
    campaignName?: string;
    emailSubject?: string;
    senderName?: string;
    senderEmail?: string;
    emailContent?: string;
    targetAudience?: E_TargetAudience;
    recipientIds?: string[];
    recipient?: I_User;
    senderType?: E_SenderType;
    scheduleDate?: Date;
    scheduleTime?: string;
    sentDate?: Date;
    recipientCount?: number;
    openCount?: number;
    clickCount?: number;
}

export interface I_Newletter extends I_Newletter_PayLoad, I_GenericDocument { }

export interface I_Input_QueyNewletter extends I_Newletter_PayLoad { }

export interface I_Input_MutateNewletter extends Omit<I_Newletter, 'id' | 'createdAt' | 'updatedAt' | 'recipient'> { }
