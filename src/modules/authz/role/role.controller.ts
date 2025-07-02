import type {
    I_Input_CreateOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateRole, I_Input_QueryRole, I_Input_UpdateRole, I_Role } from './role.type.js';

import { RoleModel } from './role.model.js';
import { rolePermissionCtr } from '../role-permission/role-permission.controller.js';

const mongooseCtr = new MongooseController<I_Role>(RoleModel);

export const roleCtr = {
    getRole: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryRole>,
    ): Promise<I_Return<I_Role>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getRoles: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryRole>,
    ): Promise<I_Return<T_PaginateResult<I_Role>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createRole: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateRole>,
    ): Promise<I_Return<I_Role>> => {
        const { name, parentId } = doc;

        const roleFound = await roleCtr.getRole(context, { filter: { name } });

        if (roleFound.success) {
            throwError({
                message: 'Role already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        let ancestors: string[] = [];
        
        if (parentId) {
            const newParentFound = await roleCtr.getRole(context, { filter: { id: parentId } });

            if (!newParentFound.success) {
                throwError({
                    message: 'Parent role not found.',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }

            const parentRole = newParentFound.result;
            
            if (parentRole.ancestors && parentRole.ancestors.length > 0) {
                ancestors = [...(parentRole.ancestors ?? []), parentId];
            } else {
                ancestors = [parentId];
            }
        }

        const roleData = {
            ...doc,
            ancestors,
        };

        return mongooseCtr.createOne(roleData);
    },
    updateRole: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateRole>,
    ): Promise<I_Return<I_Role>> => {
        const roleFound = await roleCtr.getRole(context, { filter });
        if (!roleFound.success) {
            throwError({
                message: 'Role not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }
        const role = roleFound.result;
        const { parentId } = update;

        if (parentId) {
            if (role.id === parentId) {
                throwError({
                    message: 'Cannot set parent to itself.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            if (role.ancestors && role.ancestors.includes(parentId)) {
                throwError({
                    message: 'Cannot set parent to one of its own descendants.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }

            const newParentFound = await roleCtr.getRole(context, { filter: { id: parentId } });

            if (!newParentFound.success) {
                throwError({
                    message: 'New parent not found.',
                    status: RESPONSE_STATUS.NOT_FOUND,
                });
            }
            const newParent = newParentFound.result.ancestors;

            const newAncestors = [...(newParent ?? []), parentId];

            update.ancestors = newAncestors;
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteRole: async (
        context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryRole>,
    ): Promise<I_Return<I_Role>> => {
        const roleFound = await roleCtr.getRole(context, { filter });

        if (!roleFound.success) {
            throwError({
                message: 'Role not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const childRole = await mongooseCtr.findOne({ parentId: roleFound.result.id });
        if (childRole) {
            throwError({
                message: 'Cannot delete a role that has children.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const rolePermissions = await rolePermissionCtr.getRolePermissions(context, {
            filter: { roleId: roleFound.result.id },
            options: { pagination: false }
        });

        if (rolePermissions.success && rolePermissions.result && rolePermissions.result.docs.length > 0) {
            throwError({
                message: 'Cannot delete a role that has permission assignments.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        return mongooseCtr.deleteOne(filter);
    },
};