import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export interface I_PaymentGatewaySetting extends I_GenericDocument {
    paymentGatewayId: string;
    name?: string;
    key: string;
    value: string;
}

export interface I_Input_CreatePaymentGatewaySetting {
    paymentGatewayId: string;
    key: string;
    value: string;
    name?: string;
}

export interface I_Input_UpdatePaymentGatewaySetting extends Partial<I_PaymentGatewaySetting> {}
