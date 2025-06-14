import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export interface I_Role extends I_GenericDocument {
    name?: string;
    description?: string;
    parentId?: string;
    parent?: I_Role;
}

export type T_Role_Populate = 'parent';

export interface I_Input_QueryRole extends Omit<I_Role, T_Role_Populate> { }

export interface I_Input_CreateRole extends Omit<I_Role, 'id' | 'createdAt' | 'updatedAt' | T_Role_Populate> {
    name: string;
}

export interface I_Input_UpdateRole extends Omit<I_Role, 'id' | 'createdAt' | 'updatedAt' | T_Role_Populate> {}

export enum E_Role {
    ADMIN = 'ADMIN',
    USER = 'USER',
}
