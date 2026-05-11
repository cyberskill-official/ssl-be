import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_AdminBlockUser, I_Input_AdminUnBlockUser, I_Input_CreateUser, I_Input_QueryUser, I_Input_UpdateUser, I_Input_UploadUserAvatar } from './user.type.js';

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
        softDeleteUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryUser>, context: I_Context) => userCtr.softDeleteUser(context, args),
        deactivateUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryUser>, context: I_Context) => userCtr.deactivateUser(context, args),
        completeOnboarding: (_parent: unknown, _args: unknown, context: I_Context) => userCtr.completeOnboarding(context),
        recoverUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryUser>, context: I_Context) => userCtr.recoverUser(context, args),
        adminBlockUser: (_parent: unknown, args: I_Input_CreateOne<I_Input_AdminBlockUser>, context: I_Context) => userCtr.adminBlockUser(context, args),
        adminUnBlockUser: (_parent: unknown, args: I_Input_DeleteOne<I_Input_AdminUnBlockUser>, context: I_Context) => userCtr.adminUnBlockUser(context, args),
        uploadUserAvatar: (_parent: unknown, args: I_Input_UploadUserAvatar, context: I_Context) => userCtr.uploadUserAvatar(context, args),
    },
};

export default userResolver;
