import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_MutateUser, I_Input_QueryUser } from './user.type.js';

import { userCtr } from './user.controller.js';

const userResolver = {
    Query: {
        getUser: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryUser>, context: I_Context) => userCtr.getUser(context, args),
        getUsers: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryUser>, context: I_Context) => userCtr.getUsers(context, args),
    },
    Mutation: {
        createUser: (_parent: unknown, args: I_Input_CreateOne<I_Input_MutateUser>, context: I_Context) => userCtr.createUser(context, args),
        updateUser: (_parent: unknown, args: I_Input_UpdateOne<I_Input_MutateUser>, context: I_Context) => userCtr.updateUser(context, args),
        deleteUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryUser>, context: I_Context) => userCtr.deleteUser(context, args),
        softDeleteUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryUser>, context: I_Context) => userCtr.softDeleteUser(context, args),
        restoreUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryUser>, context: I_Context) => userCtr.restoreUser(context, args),
    },
};

export default userResolver;
