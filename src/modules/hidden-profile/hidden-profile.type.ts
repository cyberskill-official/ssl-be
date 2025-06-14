import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export interface I_HiddenProfile_PayLoad {
    userId?: string;
    user?: I_User;
    hiddenUserId?: string;
    hiddenUser?: I_User;
}

export interface I_HiddenProfile extends I_HiddenProfile_PayLoad, I_GenericDocument { }

export interface I_Input_QueryHiddenProfile extends I_HiddenProfile { }

export interface I_Input_MutateHiddenProfile extends Omit<I_HiddenProfile, 'id' | 'createdAt' | 'updatedAt' | 'user' | 'hiddenUser'> { }
