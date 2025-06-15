import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_PermissionType {
    GRAPHQL = 'GRAPHQL',
    REST = 'REST',
    ROUTE = 'ROUTE',
}

export enum E_PermissionMethodGraphQL {
    QUERY = 'QUERY',
    MUTATION = 'MUTATION',
    SUBSCRIPTION = 'SUBSCRIPTION',
}

export enum E_PermissionMethodRest {
    GET = 'GET',
    POST = 'POST',
    PUT = 'PUT',
    PATCH = 'PATCH',
    DELETE = 'DELETE',
}

export interface I_Permission extends I_GenericDocument {
    target?: string;
    name?: string;
    type?: E_PermissionType;
    method?: E_PermissionMethodGraphQL | E_PermissionMethodRest;
    isPublic?: boolean;
}

export interface I_Input_QueryPermission extends I_Permission { }

export interface I_Input_CreatePermission extends Omit<I_Permission, T_Omit_Create> {
    target: string;
    name: string;
    type: E_PermissionType;
}

export interface I_Input_UpdatePermission extends Omit<I_Permission, T_Omit_Update> { }
