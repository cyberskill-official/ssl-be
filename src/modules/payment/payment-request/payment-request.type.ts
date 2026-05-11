import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_PaymentRequestStatus {
    WAITING = 'WAITING',
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
    REFUNDED = 'REFUNDED',
    EXPIRED = 'EXPIRED',
}

export interface I_PaymentRequest extends I_GenericDocument {
    gateway?: string;
    status?: E_PaymentRequestStatus;
    paymentUrl?: string;
    externalOrderId?: string;
    gatewayResponse?: Record<string, unknown> | null;
    attempts?: number;
    meta?: Record<string, unknown> | null;
}

export interface I_Input_QueryPaymentRequest extends Partial<I_PaymentRequest> {}
export interface I_Input_CreatePaymentRequest extends Omit<I_PaymentRequest, T_Omit_Create> {}
export interface I_Input_UpdatePaymentRequest extends Omit<I_PaymentRequest, T_Omit_Update> {}
