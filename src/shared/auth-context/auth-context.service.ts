import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { E_Role, E_Role_User } from '#modules/authz/index.js';
import type { I_Context } from '#shared/typescript/index.js';

import { E_Role_Staff, roleCtr } from '#modules/authz/index.js';

interface T_RoleLike {
    id?: string;
    ancestorsIds?: string[];
}

interface T_UserRoleCarrier {
    id?: string;
    rolesIds?: string[];
    roles?: T_RoleLike[];
}

type T_RoleName = E_Role_Staff | E_Role | E_Role_User | string;

interface I_GetRoleIdByNameOptions {
    allowMissing?: boolean;
    notFoundMessage?: string;
}

const roleIdCache = new Map<string, { id: string; cachedAt: number }>();
const ROLE_ID_CACHE_TTL_MS = 30 * 60 * 1000;

export async function getRoleIdByName(
    context: I_Context,
    roleName: T_RoleName,
    options?: I_GetRoleIdByNameOptions,
): Promise<string | null> {
    const roleNameKey = String(roleName);
    const cached = roleIdCache.get(roleNameKey);

    if (cached && (Date.now() - cached.cachedAt) < ROLE_ID_CACHE_TTL_MS) {
        return cached.id;
    }

    const roleFound = await roleCtr.getRole(context, {
        filter: { name: roleNameKey },
    });

    if (!roleFound.success) {
        if (options?.allowMissing) {
            return null;
        }

        throwError({
            message: options?.notFoundMessage || `Role ${roleNameKey} not found.`,
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    roleIdCache.set(roleNameKey, {
        id: roleFound.result.id,
        cachedAt: Date.now(),
    });

    return roleFound.result.id;
}

export async function getAdminRoleId(context: I_Context): Promise<string> {
    const adminRoleId = await getRoleIdByName(context, E_Role_Staff.ADMIN, {
        notFoundMessage: 'Admin role not found.',
    });

    if (!adminRoleId) {
        throwError({
            message: 'Admin role not found.',
            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
        });
    }

    return adminRoleId;
}

export function userHasRoleId(user: T_UserRoleCarrier | undefined, roleId: string): boolean {
    if (!user || !roleId) {
        return false;
    }

    if (Array.isArray(user.roles) && user.roles.some(role =>
        role.id === roleId
        || (Array.isArray(role.ancestorsIds) && role.ancestorsIds.includes(roleId)),
    )) {
        return true;
    }

    return Array.isArray(user.rolesIds) && user.rolesIds.includes(roleId);
}

export function getSessionUser(context: I_Context): T_UserRoleCarrier | undefined {
    return context?.req?.session?.user as T_UserRoleCarrier | undefined;
}

export function getSessionUserOrThrow(context: I_Context): T_UserRoleCarrier {
    const sessionUser = getSessionUser(context);

    if (!sessionUser) {
        throwError({
            message: 'User not authenticated.',
            status: RESPONSE_STATUS.UNAUTHORIZED,
        });
    }

    return sessionUser;
}

export async function userHasRole(
    context: I_Context,
    user: T_UserRoleCarrier | undefined,
    roleName: T_RoleName,
    options?: I_GetRoleIdByNameOptions,
): Promise<boolean> {
    const roleId = await getRoleIdByName(context, roleName, options);

    if (!roleId) {
        return false;
    }

    return userHasRoleId(user, roleId);
}

export async function isAdminUser(context: I_Context, user: T_UserRoleCarrier | undefined): Promise<boolean> {
    return userHasRole(context, user, E_Role_Staff.ADMIN, {
        notFoundMessage: 'Admin role not found.',
    });
}

export async function isAdminContext(context: I_Context): Promise<boolean> {
    return isAdminUser(context, getSessionUserOrThrow(context));
}
