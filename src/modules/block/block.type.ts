import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export interface I_Block extends I_GenericDocument {
    userId?: string;
    user?: I_User;
    blockId?: string;
    block?: I_User;
}

export type T_Block_Populate = 'user' | 'block';

export interface I_Input_QueryBlock extends Omit<I_Block, T_Block_Populate> { }

export interface I_Input_CreateBlock extends Omit<I_Block, 'id' | 'createdAt' | 'updatedAt' | T_Block_Populate> {
    userId: string;
    blockId: string;
}

export interface I_Input_UpdateBlock extends Omit<I_Block, 'id' | 'createdAt' | 'updatedAt' | T_Block_Populate> {}
