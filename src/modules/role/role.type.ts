import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export interface I_Role_Payload {
    name?: string;
    description?: string;
}

export interface I_Role extends I_GenericDocument, I_Role_Payload { }

export interface I_Input_CreateRole extends I_Role_Payload { }

export enum E_Role {
    ADMIN = 'ADMIN',
    USER = 'USER',
}
