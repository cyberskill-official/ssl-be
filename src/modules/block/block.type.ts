import type { I_GenericDocument, T_Omit_Create } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

export interface I_Block extends I_GenericDocument {
    userId?: string;
    user?: I_User;
    blockId?: string;
    block?: I_User;
}

export type T_Block_Populate = 'user' | 'block';

export interface I_Input_QueryBlock extends Omit<I_Block, T_Block_Populate> { }

export interface I_Input_CreateBlock extends Omit<I_Block, T_Omit_Create | T_Block_Populate> {
    userId: string;
    blockId: string;
}

export interface I_Input_Block {
    blockId: string;
}

export interface I_Input_UnBlock {
    blockId: string;
}
