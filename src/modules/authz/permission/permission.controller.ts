import type {
    I_Input_CreateOne,
    I_Input_DeleteOne,
    I_Input_FindOne,
    I_Input_FindPaging,
    I_Input_UpdateOne,
    T_PaginateResult,
    T_QueryFilter,
} from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreatePermission, I_Input_QueryPermission, I_Input_UpdatePermission, I_Permission } from './permission.type.js';

import { clearAuthzCache, invalidatePermissionAuthzCache } from '../authz.cache.js';
import { rolePermissionCtr } from '../role-permission/role-permission.controller.js';
import { roleCtr } from '../role/role.controller.js';
import { PermissionModel } from './permission.model.js';
import { scanGraphqlResolvers, scanRestApiEndpoints } from './permission.scan.js';
import { E_PermissionType } from './permission.type.js';

const mongooseCtr = new MongooseController<I_Permission>(PermissionModel);

export const permissionCtr = {
    getPermission: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryPermission>,
    ): Promise<I_Return<I_Permission>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getPermissions: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryPermission>,
    ): Promise<I_Return<T_PaginateResult<I_Permission>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createPermission: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreatePermission>,
    ): Promise<I_Return<I_Permission>> => {
        const result = await mongooseCtr.createOne(doc);
        if (result.success) {
            await invalidatePermissionAuthzCache(result.result.id, result.result.type, result.result.target);
        }
        return result;
    },
    updatePermission: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdatePermission>,
    ): Promise<I_Return<I_Permission>> => {
        const permissionFound = await permissionCtr.getPermission(context, { filter });

        if (!permissionFound.success) {
            throwError({
                message: 'Permission not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const type = permissionFound.result.type;

        if (type === E_PermissionType.ROUTE) {
            const allowedFields = ['name', 'target', 'isPublic'];
            const updateKeys = Object.keys(update);

            const hasInvalidFields = updateKeys.some(key => !allowedFields.includes(key));

            if (hasInvalidFields) {
                throwError({
                    message: 'For ROUTE type permissions, only name and target fields can be updated.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }
        else {
            const allowedFields = ['name', 'isPublic'];
            const updateKeys = Object.keys(update);

            const hasInvalidFields = updateKeys.some(key => !allowedFields.includes(key));

            if (hasInvalidFields) {
                throwError({
                    message: 'For GRAPHQL and REST type permissions, only name and isPublic fields can be updated.',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        const result = await mongooseCtr.updateOne(filter, update, options);
        if (result.success) {
            await clearAuthzCache();
        }
        return result;
    },
    deletePermission: async (
        _context: I_Context,
        { filter }: I_Input_DeleteOne<I_Input_QueryPermission>,
    ): Promise<I_Return<I_Permission>> => {
        const result = await mongooseCtr.deleteOne(filter);
        if (result.success) {
            await clearAuthzCache();
        }
        return result;
    },
    syncPermissions: async () => {
        try {
            log.info('Starting permission synchronization...');

            // 1. Scan permissions from code
            const graphqlPermissions = await scanGraphqlResolvers();
            const restPermissions = scanRestApiEndpoints();
            const allPermissions = [...graphqlPermissions, ...restPermissions];

            log.info(`Found ${graphqlPermissions.length} GraphQL permissions and ${restPermissions.length} REST permissions`);

            // 2. Get all permissions in database
            const apiTypes = [E_PermissionType.GRAPHQL, E_PermissionType.REST];
            const apiPermissionFilter = { type: { $in: apiTypes } } as unknown as T_QueryFilter<I_Permission>;
            const dbPermissionsResult = await mongooseCtr.findPaging(apiPermissionFilter, { pagination: false });

            if (!dbPermissionsResult.success) {
                throwError({
                    message: 'Failed to fetch existing permissions from database.',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            let dbPermissions: I_Permission[] = [];
            if (dbPermissionsResult.result) {
                dbPermissions = dbPermissionsResult.result.docs || [];
            }
            const dbPermissionKeys = dbPermissions.map(p => `${p.type}_${p.method}_${p.target}`);

            log.info(`Found ${dbPermissions.length} existing permissions in database`);

            // 3. Create new permissions
            const newPermissions = allPermissions.filter((perm) => {
                const key = `${perm.type}_${perm.method}_${perm.target}`;
                return !dbPermissionKeys.includes(key);
            });

            if (newPermissions.length > 0) {
                const createResult = await mongooseCtr.createMany(newPermissions.map(permission => ({
                    ...permission,
                    isPublic: permission.isPublic === true,
                })));
                if (!createResult.success) {
                    throwError({
                        message: 'Failed to create new permissions.',
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                    });
                }
                log.info(`Created ${newPermissions.length} new permissions`);
            }
            else {
                log.info('No new permissions to create');
            }

            // 4. Force public bootstrap permissions while preserving other admin-managed flags.
            const publicPermissions = allPermissions.filter(permission => permission.isPublic === true);
            let publicUpdatedCount = 0;
            for (const publicPermission of publicPermissions) {
                const existingPermission = dbPermissions.find(dbPermission =>
                    `${dbPermission.type}_${dbPermission.method}_${dbPermission.target}`
                    === `${publicPermission.type}_${publicPermission.method}_${publicPermission.target}`,
                );

                if (existingPermission && !existingPermission.isPublic) {
                    const updateResult = await mongooseCtr.updateOne(
                        { id: existingPermission.id },
                        { isPublic: true },
                    );
                    if (updateResult.success) {
                        publicUpdatedCount++;
                    }
                }
            }
            log.info(`Forced ${publicUpdatedCount} bootstrap permissions to public`);

            // 5. Report obsolete API permissions only. They may still be referenced by admin state.
            const obsoletePermissions = dbPermissions.filter((dbPerm) => {
                const key = `${dbPerm.type}_${dbPerm.method}_${dbPerm.target}`;
                return !allPermissions.some(p => `${p.type}_${p.method}_${p.target}` === key);
            });

            log.info(`Detected ${obsoletePermissions.length} obsolete API permissions; preserving them`);

            // 6. Assign all API permissions to ADMIN role
            await permissionCtr.assignAllPermissionsToAdmin();
            await clearAuthzCache();

            log.info('Permission synchronization completed successfully!');
        }
        catch (error) {
            log.error('Permission synchronization failed:', error);
            throw error;
        }
    },
    assignAllPermissionsToAdmin: async () => {
        try {
            const adminRoleResult = await roleCtr.getRole({}, {
                filter: { name: 'ADMIN' },
            });

            if (!adminRoleResult.success || !adminRoleResult.result) {
                log.warn('ADMIN role not found, skipping permission assignment');
                return;
            }
            const adminRoleId = adminRoleResult.result.id;
            if (!adminRoleId) {
                log.warn('ADMIN role id not found, skipping permission assignment');
                return;
            }

            const apiPermissionFilter = {
                type: { $in: [E_PermissionType.GRAPHQL, E_PermissionType.REST] },
            } as unknown as T_QueryFilter<I_Permission>;
            const allPermissionsResult = await mongooseCtr.findPaging(apiPermissionFilter, { pagination: false });

            if (!allPermissionsResult.success || !allPermissionsResult.result) {
                log.warn('No permissions found, skipping ADMIN assignment');
                return;
            }

            const existingRolePermissionsResult = await rolePermissionCtr.getRolePermissions({}, {
                filter: { roleId: adminRoleId },
                options: { pagination: false },
            });

            const existingPermissionIds = new Set<string>();

            if (existingRolePermissionsResult.success && existingRolePermissionsResult.result) {
                existingRolePermissionsResult.result.docs.forEach((rp) => {
                    if (rp.permissionId) {
                        existingPermissionIds.add(rp.permissionId);
                    }
                });
            }

            const newRolePermissions = allPermissionsResult.result.docs
                .filter((permission): permission is I_Permission & { id: string } =>
                    typeof permission.id === 'string' && !existingPermissionIds.has(permission.id))
                .map(permission => ({
                    roleId: adminRoleId,
                    permissionId: permission.id,
                }));

            if (newRolePermissions.length > 0) {
                const createResult = await rolePermissionCtr.createRolePermissions({}, {
                    docs: newRolePermissions,
                });

                if (!createResult.success) {
                    log.error('Failed to assign permissions to ADMIN role');
                    return;
                }

                await clearAuthzCache();
                log.info(`Assigned ${newRolePermissions.length} permissions to ADMIN role`);
            }
            else {
                log.info('ADMIN role already has all permissions');
            }
        }
        catch (error) {
            log.error('Failed to assign permissions to ADMIN role:', error);
        }
    },
};
