import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Input_Id } from '#shared/typescript/index.js';

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
    roleId: string;
    permissionIds?: string[];
}

export interface I_User extends I_GenericDocument, I_User_Payload { }

export interface I_Input_CreateUser extends I_User_Payload { }

export interface I_Input_UpdateUser extends Omit<I_User_Payload, 'password'>, I_Input_Id { }
