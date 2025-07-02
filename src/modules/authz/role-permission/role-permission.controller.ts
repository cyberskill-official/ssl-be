import type {
    I_Input_CreateOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateRolePermission, I_Input_QueryRolePermission, I_RolePermission } from './role-permission.type.js';

import { RolePermissionModel } from './role-permission.model.js';

const mongooseCtr = new MongooseController<I_RolePermission>(RolePermissionModel);

export const rolePermissionCtr = {
    getRolePermissions: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryRolePermission>,
    ): Promise<I_Return<T_PaginateResult<I_RolePermission>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createRolePermission: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateRolePermission>,
    ): Promise<I_Return<I_RolePermission>> => {
        const rolePermissionfound = await mongooseCtr.findOne({ roleId: doc.roleId, permissionId: doc.permissionId });

        if (rolePermissionfound.success) {
            throwError({
                message: 'Role-permission mapping already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.createOne(doc);
    },
    deleteRolePermission: async (
        _context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryRolePermission>,
    ): Promise<I_Return<I_RolePermission>> => {
        return mongooseCtr.deleteOne(filter);
    },
};
