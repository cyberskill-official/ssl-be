import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export enum E_ApiType {
    GRAPHQL = 'GRAPHQL',
    REST = 'REST',
}

export enum E_GraphQLKind {
    MUTATION = 'MUTATION',
    QUERY = 'QUERY',
    SUBSCRIPTION = 'SUBSCRIPTION',
}

export enum E_RestApiMethod {
    DELETE = 'DELETE',
    GET = 'GET',
    PATCH = 'PATCH',
    POST = 'POST',
    PUT = 'PUT',
}

export interface I_Permission_Payload {
    name: string;
    description?: string;
    type: E_ApiType;
    kind: E_GraphQLKind;
    methods?: E_RestApiMethod[];
    allowedRoleIds?: string[];
    isPublic?: boolean;
}

export interface I_Permission extends I_GenericDocument, I_Permission_Payload { }

export interface I_Input_CreatePermission extends I_Permission_Payload { }
