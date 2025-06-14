import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export interface I_Follow extends I_GenericDocument {
    userId?: string;
    user?: I_User;
    followId?: string;
    follow?: I_User;
}

export type T_Follow_Populate = 'user' | 'follow';

export interface I_Input_QueryFollow extends Omit<I_Follow, T_Follow_Populate> { }

export interface I_Input_CreateFollow extends Omit<I_Follow, 'id' | 'createdAt' | 'updatedAt' | T_Follow_Populate> {
    userId: string;
    followId: string;
}

export interface I_Input_UpdateFollow extends Omit<I_Follow, 'id' | 'createdAt' | 'updatedAt' | T_Follow_Populate> {}
