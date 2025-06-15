import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Input_Note, I_Note } from '#modules/note/index.js';
import type { I_User } from '#modules/user/index.js';

export enum E_ModerationMediaType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export enum E_ModerationMediaStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}

export interface I_ModerationMedia extends I_GenericDocument {
    type?: E_ModerationMediaType;
    uploadedById?: string;
    uploadedBy?: I_User;
    url?: string;
    status?: E_ModerationMediaStatus;
    moderatedById?: string;
    moderatedBy?: I_User;
    reason?: string;
    notes?: I_Note[];
}

export type T_ModerationMedia_Populate = 'uploadedBy' | 'moderatedBy';

export interface I_Input_QueryModerationMedia extends Omit<I_ModerationMedia, T_ModerationMedia_Populate> {
    notes?: I_Input_Note[];
}

export interface I_Input_CreateModerationMedia extends Omit<I_ModerationMedia, T_Omit_Create | T_ModerationMedia_Populate> {
    type: E_ModerationMediaType;
    uploadedById: string;
    url: string;
    notes?: I_Input_Note[];
}

export interface I_Input_UpdateModerationMedia extends Omit<I_ModerationMedia, T_Omit_Update | T_ModerationMedia_Populate> {
    notes?: I_Input_Note[];
}
