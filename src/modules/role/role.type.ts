import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export interface I_Role_Payload {
    name?: string;
    description?: string;
}

export interface I_Role extends I_GenericDocument, I_Role_Payload { }

export interface I_Input_QueryRole extends I_Role { }

export interface I_Input_MutateRole extends Omit<I_Role, 'id' | 'createdAt' | 'updatedAt'> { }

export enum E_Role {
    ADMIN = 'ADMIN',
    USER = 'USER',
}
