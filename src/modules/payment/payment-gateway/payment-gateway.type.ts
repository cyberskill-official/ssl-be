import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export interface I_PaymentGateway_Payload {
    name?: string;
    code?: string;
    fee?: number;
    image?: string;
    status?: string;
}

export interface I_PaymentGateway extends I_GenericDocument, I_PaymentGateway_Payload {
    settings?: Record<string, unknown>[];
}

export interface I_Input_CreatePaymentGateway extends I_PaymentGateway_Payload {}
export interface I_Input_UpdatePaymentGateway extends I_PaymentGateway_Payload { id?: string }
