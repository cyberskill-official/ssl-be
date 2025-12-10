import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Permission } from '../permission/index.js';
import type { I_Role } from '../role/index.js';

export interface I_RolePermission extends I_GenericDocument {
    roleId?: string;
    role?: I_Role;
    permissionId?: string;
    permission?: I_Permission;
}

export type T_RolePermission_Populate = 'role' | 'permission';

export interface I_Input_QueryRolePermission extends Omit<I_RolePermission, T_RolePermission_Populate> { }

export interface I_Input_CreateRolePermission extends Omit<I_RolePermission, T_Omit_Create | T_RolePermission_Populate> {
    roleId: string;
    permissionId: string;
}

export interface I_Input_UpdateRolePermission extends Omit<I_RolePermission, T_Omit_Update | T_RolePermission_Populate> {}
