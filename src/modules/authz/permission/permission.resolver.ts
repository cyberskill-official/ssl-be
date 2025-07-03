import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePermission, I_Input_QueryPermission, I_Input_UpdatePermission } from './permission.type.js';

import { permissionCtr } from './permission.controller.js';

const permissionResolver = {
    Query: {
        getPermission: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryPermission>, context: I_Context) => permissionCtr.getPermission(context, args),
        getPermissions: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryPermission>, context: I_Context) => permissionCtr.getPermissions(context, args),
    },
    Mutation: {
        createPermission: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreatePermission>, context: I_Context) => permissionCtr.createPermission(context, args),
        updatePermission: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdatePermission>, context: I_Context) => permissionCtr.updatePermission(context, args),
        deletePermission: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryPermission>, context: I_Context) => permissionCtr.deletePermission(context, args),
    },
};

export default permissionResolver;
