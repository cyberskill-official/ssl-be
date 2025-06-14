import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/user.type.js';

export interface I_Follower_PayLoad {
    followerId?: string;
    follower?: I_User;
    followeeId?: string;
    followee?: I_User;
}

export interface I_Follower extends I_Follower_PayLoad, I_GenericDocument { }

export interface I_Input_QueryFollower extends I_Follower { }

export interface I_Input_MutateFollower extends Omit<I_Follower, 'id' | 'createdAt' | 'updatedAt' | 'follower' | 'followee'> { }
