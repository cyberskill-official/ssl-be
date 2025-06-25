import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_VerificationMethod {
    EMAIL_OTP = 'EMAIL_OTP',
    SMS_OTP = 'SMS_OTP',
    T_OTP = 'T_OTP',
    MAGIC_LINK = 'MAGIC_LINK',
    BIOMETRIC = 'BIOMETRIC',
    QR_CODE = 'QR_CODE',
}

export enum E_VerificationContext {
    SIGNUP = 'signup',
    LOGIN = 'login',
    RESET_PASSWORD = 'reset-password',
}

export enum E_VerificationPlatform {
    WEB = 'web',
    ANDROID = 'android',
    IOS = 'ios',
}

export interface I_VerificationMeta {
    context?: E_VerificationContext;
    platform?: E_VerificationPlatform;
    ip?: string;
    userAgent?: string;
    location?: {
        country?: string;
        city?: string;
    };
    extra?: Record<string, any>;
}

export interface I_Verification extends I_GenericDocument {
    identifier?: string;
    value?: string;
    method?: E_VerificationMethod;
    attemptCount?: number;
    maxAttempts?: number;
    expiresAt?: Date;
    meta?: I_VerificationMeta;
}

export interface I_Input_QueryVerification extends I_Verification { }

export interface I_Input_UpdateVerification extends Omit<I_Verification, T_Omit_Update> { }

export interface I_Input_CreateVerification extends Omit<I_Verification, T_Omit_Create> {
    identifier: string;
    value: string;
    method?: E_VerificationMethod;
    maxAttempts?: number;
    expiresAt: Date;
    meta?: I_VerificationMeta;
}

export interface I_Input_CheckVerification {
    identifier: string;
    value: string;
    method?: string;
}

export interface I_Result_CheckVerification {
    isValid: boolean;
    verification?: I_Verification;
    remainingAttempts?: number;
}
