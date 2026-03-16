import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export interface I_Banner extends I_GenericDocument {
    image?: string;
    targetURL?: string;
    createdById?: string;
    createdBy?: I_User;
    clickCount?: number;
    isActive?: boolean;
}

export type T_Banner_Populate = 'createdBy';

export interface I_Input_QueryBanner extends Omit<I_Banner, T_Banner_Populate> { }

export interface I_Input_CreateBanner extends Omit<I_Banner, T_Omit_Create> {
    image: string;
    targetURL: string;
}

export interface I_Input_UpdateBanner extends Omit<I_Banner, T_Omit_Update> { }
