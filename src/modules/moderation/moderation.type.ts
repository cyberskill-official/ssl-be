import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Note, I_User } from '#modules/user/user.type.js';

export enum E_ModerationType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export enum E_ModerationStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}

export interface I_Moderation_PayLoad {
    type?: E_ModerationType;
    uploadedById?: string;
    uploadedBy?: I_User;
    url?: string;
    status?: E_ModerationStatus;
    moderatedById?: string;
    reason?: string;
    notes?: I_Note[];
}

export interface I_Moderation extends I_Moderation_PayLoad, I_GenericDocument { }

export interface I_Input_QueryModeration extends I_Moderation { }

export interface I_Input_MutateModeration extends Omit<I_Moderation, 'id' | 'createdAt' | 'updatedAt' | 'uploadedBy'> { }
