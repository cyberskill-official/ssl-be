import type { I_Input_CreateOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateRole, I_Input_QueryRole, I_Input_UpdateRole } from './role.type.js';

import { roleCtr } from './role.controller.js';

const roleResolver = {
    Query: {
        getRole: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryRole>, context: I_Context) => roleCtr.getRole(context, args),
        getRoles: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryRole>, context: I_Context) => roleCtr.getRoles(context, args),
    },
    Mutation: {
        createRole: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateRole>, context: I_Context) => roleCtr.createRole(context, args),
        updateRole: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateRole>, context: I_Context) => roleCtr.updateRole(context, args),
        deleteRole: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryRole>, context: I_Context) => roleCtr.deleteRole(context, args),
    },
};

export default roleResolver;
