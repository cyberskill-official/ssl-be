import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Input_Note, I_Note } from '#modules/note/index.js';
import type { I_Tag } from '#modules/tag/index.js';
import type { I_User } from '#modules/user/index.js';
import type { E_Entity } from '#shared/typescript/index.js';

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
    entity?: E_Entity;
    entityId?: string;
    // Optional, used for specific modules like catalogue
    tagId?: string;
    tag?: I_Tag;
    // Optional, used for specific modules like gallery
    isPublished?: boolean;
}

export type T_ModerationMedia_Populate = 'uploadedBy' | 'moderatedBy' | 'notes' | 'tag';

export interface I_Input_QueryModerationMedia extends Omit<I_ModerationMedia, T_ModerationMedia_Populate> {
    notes?: I_Input_Note[];
}

export interface I_Input_CreateModerationMedia extends Omit<I_ModerationMedia, T_Omit_Create | T_ModerationMedia_Populate> {
    type: E_ModerationMediaType;
    uploadedById: string;
    url: string;
}

export interface I_Input_UpdateModerationMedia extends Omit<I_ModerationMedia, T_Omit_Update | T_ModerationMedia_Populate> { }

export interface I_Input_ApproveModerationMedia extends Pick<I_ModerationMedia, 'id'> {
    id: string;
}
export interface I_Input_RejectModerationMedia extends Pick<I_ModerationMedia, 'id' | 'reason'> {
    id: string;
    reason: string;
}
