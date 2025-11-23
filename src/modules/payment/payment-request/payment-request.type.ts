import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Currency } from '#modules/location/currency/currency.type.js';
import type { I_Order } from '#modules/order/order.type.js';

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
    order?: I_Order;
    orderId?: string;
    clientOrderId?: string;
    amount?: number;
    currencyId?: string;
    currency?: I_Currency;
    gateway?: string;
    status?: E_PaymentRequestStatus;
    paymentUrl?: string;
    externalOrderId?: string;
    gatewayResponse?: Record<string, unknown> | null;
    attempts?: number;
    expiresAt?: Date | null;
    meta?: Record<string, unknown> | null;
}

export interface I_Input_QueryPaymentRequest extends Partial<I_PaymentRequest> {}
export interface I_Input_CreatePaymentRequest extends Omit<I_PaymentRequest, T_Omit_Create> {}
export interface I_Input_UpdatePaymentRequest extends Omit<I_PaymentRequest, T_Omit_Update> {}

export type T_PaymentRequest_Populate = 'order';
