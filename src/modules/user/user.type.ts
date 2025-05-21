import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Role } from '#modules/role/index.js';

export enum E_User_Gender {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
    OTHER = 'OTHER',
    PREFER_NOT_TO_SAY = 'PREFER_NOT_TO_SAY',
}

export interface I_User_Payload {
    fullName?: string;
    avatar?: string;
    email?: string;
    phoneNumber?: string;
    gender?: E_User_Gender;
    dateOfBirth?: Date;
    password?: string;
    roleId?: string;
    role?: I_Role;
}

export interface I_User extends I_GenericDocument, I_User_Payload { }

export interface I_Input_QueryUser extends Omit<I_User, 'password' | 'role'> { }

export interface I_Input_MutateUser extends Omit<I_User, 'id' | 'createdAt' | 'updatedAt' | 'role'> { }
