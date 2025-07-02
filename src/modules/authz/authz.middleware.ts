import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context, I_NextFunction } from '#shared/typescript/express.js';

import { permissionCtr } from './permission/permission.controller.js';
import { E_PermissionType } from './permission/permission.type.js';
import { rolePermissionCtr } from './role-permission/role-permission.controller.js';

export const authz = {
    checkAuthorizedGraphql: async (context: I_Context) => {
        const user = context?.req?.session?.user!;
        const roleIds: string[] = user.rolesIds!;
        const info = context?.info!;

        // Auto-detect the target from GraphQL operation info
        const operationType = info.operation.operation; // 'query', 'mutation', 'subscription'
        const fieldName = info.fieldName; // The actual field being called
        const target = `${operationType.toUpperCase()}_${fieldName}`;

        const rolesPermissionFound = await rolePermissionCtr.getRolePermissions({}, {
            filter: { roleId: { $in: roleIds } },
            options: { populate: 'permission', pagination: false },
        });

        if (!rolesPermissionFound.success || rolesPermissionFound.result.docs.length === 0) {
            throwError({
                message: 'Unauthorized: No permissions found for the assigned roles.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const userPermissions = rolesPermissionFound.result.docs.map(rp => rp.permission?.target);

        if (!userPermissions || userPermissions.length === 0) {
            throwError({
                message: 'Unauthorized: No permissions found for the assigned roles.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        if (!userPermissions.includes(target)) {
            throwError({
                message: 'Forbidden: You do not have permission to access this resource.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }
    },
    checkAuthorizedRest: async (context: I_Context, next: I_NextFunction) => {
        const path = context?.req?.path;
        const currentUser = context?.req?.session?.user;

        if (path === '/') {
            return next();
        }

        const permissionFound = await permissionCtr.getPermission(context, {
            filter: { target: path, type: E_PermissionType.REST },
        });

        if (!permissionFound.success) {
            throwError({
                message: 'Permission not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { isPublic } = permissionFound.result ?? {};

        if (isPublic) {
            return next();
        }

        if (!currentUser) {
            throwError({
                message: 'Unauthorized: You must be logged in to use this API.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        if (!currentUser.rolesIds || currentUser.rolesIds.length === 0) {
            throwError({
                message: 'Unauthorized: No roles assigned.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const roleIds: string[] = currentUser.rolesIds;

        const rolesPermissionFound = await rolePermissionCtr.getRolePermissions({}, {
            filter: { roleId: { $in: roleIds } },
            options: { populate: 'permission', limit: 0 },
        });

        if (!rolesPermissionFound.success || rolesPermissionFound.result.docs.length === 0) {
            throwError({
                message: 'Unauthorized: No permissions found for the assigned roles.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        const userPermissions = rolesPermissionFound.result.docs.map(rp => rp.permission?.target);

        if (!userPermissions || userPermissions.length === 0) {
            throwError({
                message: 'Unauthorized: No permissions found for the assigned roles.',
                status: RESPONSE_STATUS.UNAUTHORIZED,
            });
        }

        if (!userPermissions.includes(path)) {
            throwError({
                message: 'Forbidden: You do not have permission to access this API.',
                status: RESPONSE_STATUS.FORBIDDEN,
            });
        }

        return next();
    },
};
