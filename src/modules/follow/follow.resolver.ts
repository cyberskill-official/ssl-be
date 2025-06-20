import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_Follow, I_Input_UnFollow } from './follow.type.js';

import { followCtr } from './follow.controller.js';

const followResolver = {
    Query: {
        getFollowers: (_parent: unknown, args: I_Input_FindPaging, context: I_Context) => followCtr.getFollowers(context, args),
        getFollowings: (_parent: unknown, args: I_Input_FindPaging, context: I_Context) => followCtr.getFollowings(context, args),
    },
    Mutation: {
        follow: (_parent: unknown, args: I_Input_CreateOne<I_Input_Follow>, context: I_Context) => followCtr.follow(context, args),
        unFollow: (_parent: unknown, args: I_Input_DeleteOne<I_Input_UnFollow>, context: I_Context) => followCtr.unFollow(context, args),
    },
};

export default followResolver;
