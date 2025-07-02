import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export interface I_Role extends I_GenericDocument {
    name?: string;
    description?: string;
    parentId?: string;
    parent?: I_Role;
    ancestors?: string[];
    ancestorsIds?: I_Role;
}

export type T_Role_Populate = 'parent';

export interface I_Input_QueryRole extends Omit<I_Role, T_Role_Populate> { }

export interface I_Input_CreateRole extends Omit<I_Role, T_Omit_Create | T_Role_Populate> {
    name: string;
}

export interface I_Input_UpdateRole extends Omit<I_Role, T_Omit_Update | T_Role_Populate> {}

export enum E_Role {
    STAFF = 'STAFF',
    USER = 'USER',
}

export enum E_Role_Staff {
    ADMIN = 'ADMIN',
    MODERATOR = 'MODERATOR',
    VIEWER = 'VIEWER',
}

export enum E_Role_User {
    FREE_MEMBER = 'FREE_MEMBER',
    PAID_MEMBER = 'PAID_MEMBER',
}
