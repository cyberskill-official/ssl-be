import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateUser, I_Input_QueryUser, I_Input_UpdateUser } from './user.type.js';

import { userCtr } from './user.controller.js';

const userResolver = {
    Query: {
        getUser: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryUser>, context: I_Context) => userCtr.getUser(context, args),
        getUsers: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryUser>, context: I_Context) => userCtr.getUsers(context, args),
    },
    Mutation: {
        createUser: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateUser>, context: I_Context) => userCtr.createUser(context, args),
        updateUser: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateUser>, context: I_Context) => userCtr.updateUser(context, args),
        deleteUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryUser>, context: I_Context) => userCtr.deleteUser(context, args),
    },
};

export default userResolver;
