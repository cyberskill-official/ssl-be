import type { I_GenericDocument, T_Omit_Create } from '@cyberskill/shared/node/mongo';

import type { I_Blog } from '#modules/blog/index.js';
import type { I_Message } from '#modules/conversation/index.js';
import type { I_Gallery } from '#modules/gallery/index.js';
import type { I_User } from '#modules/user/user.type.js';

export enum E_EntityType {
    GALLERY = 'GALLERY',
    BLOG = 'BLOG',
    MESSAGE = 'MESSAGE',
}

export interface I_Like extends I_GenericDocument {
    userId?: string;
    user?: I_User;
    entityType?: E_EntityType;
    entityId?: string;
    entity?: I_Gallery | I_Blog | I_Message;
}

export type T_Like_Populate = 'user' | 'entity';

export interface I_Input_QueryLike extends Omit<I_Like, T_Like_Populate> { }

export interface I_Input_CreateLike extends Omit<I_Like, T_Omit_Create | T_Like_Populate> {
    entityType: E_EntityType;
    entityId: string;
}

export interface I_Input_GetLikeCountBatch {
    entityType: E_EntityType;
    entityIds: string[];
}
