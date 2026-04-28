import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateRolePermission, I_Input_QueryRolePermission } from './role-permission.type.js';

import { rolePermissionCtr } from './role-permission.controller.js';

const rolePermissionResolver = {
    Query: {
        getRolePermissions: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryRolePermission>, context: I_Context) => rolePermissionCtr.getRolePermissions(context, args),
    },
    Mutation: {
        createRolePermission: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateRolePermission>, context: I_Context) =>
            rolePermissionCtr.createRolePermission(context, args),
        deleteRolePermission: (_parent: unknown, args: I_Input_DeleteOne<I_Input_QueryRolePermission>, context: I_Context) =>
            rolePermissionCtr.deleteRolePermission(context, args),
    },
};

export default rolePermissionResolver;
