import type { I_User, I_User_Payload } from '#modules/user/index.js';

export interface I_SessionPayload {
    createdAt: number;
    userId: string;
}

export interface I_Input_CheckToken {
    token: string;
}

export interface I_Input_CheckAuth {
    token: string;
}

export interface I_Input_Login {
    identity: string;
    password: string;
    rememberMe?: boolean;
    phone?: number;
}

export interface I_Input_Register extends Omit<I_User_Payload, 'roleId'> {}

export interface I_Response_Auth {
    success: boolean;
    message?: string;
    result?: {
        user?: Omit<I_User, 'password'>;
        token?: string;
    };
}
