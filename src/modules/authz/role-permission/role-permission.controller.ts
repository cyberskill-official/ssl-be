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

import { roleCtr } from '../role/index.js';
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
        const existingRolePermission = await mongooseCtr.findOne({ roleId: doc.roleId, permissionId: doc.permissionId });

        if (existingRolePermission.success) {
            throwError({
                message: 'Role-permission mapping already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const validation = await rolePermissionCtr.validatePermissionAssignment(_context, doc.roleId, doc.permissionId);

        if (!validation.success) {
            throwError({
                message: validation.message || 'Failed to validate permission assignment.',
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
            });
        }

        if (!validation.result?.canAssign) {
            throwError({
                message: validation.result?.reason || 'Cannot assign permission due to inheritance rules.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        const result = await mongooseCtr.createOne(doc);

        if (result.success) {
            await rolePermissionCtr.propagatePermissionChange(_context, doc.roleId, doc.permissionId, true);
        }

        return result;
    },
    createRolePermissions: async (
        _context: I_Context,
        { docs }: { docs: Array<{ roleId: string; permissionId: string }> },
    ): Promise<I_Return<I_RolePermission[]>> => {
        return mongooseCtr.createMany(docs);
    },
    deleteRolePermission: async (
        context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryRolePermission>,
    ): Promise<I_Return<I_RolePermission>> => {
        const existingRolePermission = await mongooseCtr.findOne(filter);

        const result = await mongooseCtr.deleteOne(filter);

        if (result.success && existingRolePermission.success && existingRolePermission.result) {
            await rolePermissionCtr.propagatePermissionChange(
                context,
                existingRolePermission.result.roleId!,
                existingRolePermission.result.permissionId!,
                false,
            );
        }

        return result;
    },
    checkParentPermission: async (
        context: I_Context,
        roleId: string,
        permissionId: string,
    ): Promise<I_Return<boolean>> => {
        const roleResult = await roleCtr.getRole(context, { filter: { id: roleId } });

        if (!roleResult.success || !roleResult.result || !roleResult.result.parentId) {
            return {
                success: true,
                result: false,
            };
        }

        const parentRolePermissionResult = await mongooseCtr.findOne({
            roleId: roleResult.result.parentId,
            permissionId,
        });

        return {
            success: true,
            result: parentRolePermissionResult.success && !!parentRolePermissionResult.result,
        };
    },
    propagatePermissionChange: async (
        context: I_Context,
        roleId: string,
        permissionId: string,
        isGranted: boolean,
    ): Promise<I_Return<void>> => {
        if (!isGranted) {
            const revokeResult = await rolePermissionCtr.revokeFromChildren(context, roleId, permissionId);

            if (!revokeResult.success) {
                return {
                    success: false,
                    message: 'Failed to propagate permission changes to children.',
                    code: 'PROPAGATION_FAILED',
                };
            }
        }

        return {
            success: true,
            result: undefined,
        };
    },
    revokeFromChildren: async (
        context: I_Context,
        parentRoleId: string,
        permissionId: string,
    ): Promise<I_Return<void>> => {
        try {
            const childrenRolesResult = await roleCtr.getRoles(context, {
                filter: { parentId: parentRoleId },
                options: { pagination: false },
            });

            if (!childrenRolesResult.success || !childrenRolesResult.result) {
                return {
                    success: true,
                    result: undefined,
                };
            }

            const childrenRoleIds = childrenRolesResult.result.docs.map(role => role.id!);

            for (const childRoleId of childrenRoleIds) {
                await mongooseCtr.deleteOne({
                    roleId: childRoleId,
                    permissionId,
                });

                await rolePermissionCtr.revokeFromChildren(context, childRoleId, permissionId);
            }

            return {
                success: true,
                result: undefined,
            };
        }
        catch {
            return {
                success: false,
                message: 'Failed to revoke permissions from children.',
                code: 'REVOKE_FROM_CHILDREN_FAILED',
            };
        }
    },
    validatePermissionAssignment: async (
        context: I_Context,
        roleId: string,
        permissionId: string,
    ): Promise<I_Return<{ canAssign: boolean; reason?: string }>> => {
        const parentHasPermissionResult = await rolePermissionCtr.checkParentPermission(context, roleId, permissionId);

        if (!parentHasPermissionResult.success) {
            return {
                success: false,
                message: 'Failed to check parent permission.',
                code: 'PARENT_PERMISSION_CHECK_FAILED',
            };
        }

        if (!parentHasPermissionResult.result) {
            return {
                success: true,
                result: {
                    canAssign: false,
                    reason: 'Parent role does not have this permission.',
                },
            };
        }

        return {
            success: true,
            result: { canAssign: true },
        };
    },
};
