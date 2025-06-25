import type { I_User } from '#modules/user/index.js';

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
}

export interface I_Response_Auth {
    success: boolean;
    message?: string;
    result?: {
        user?: Omit<I_User, 'password'>;
        token?: string;
    };
}
