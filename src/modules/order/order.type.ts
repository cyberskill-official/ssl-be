import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_PaymentTransaction } from '#modules/payment/index.js';

export enum E_OrderStatus {
    CREATED = 'CREATED',
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}

export enum E_OrderType {
    SUBSCRIPTION = 'SUBSCRIPTION',
    A_LA_CARTE_EVENT = 'A_LA_CARTE_EVENT',
}

export interface I_Order extends I_GenericDocument {
    userId?: string;
    amount?: number;
    status?: E_OrderStatus;
    orderType?: E_OrderType; // SUBSCRIPTION or A_LA_CARTE_EVENT
    paymentTransactionId?: string;
    paymentTransaction?: I_PaymentTransaction;
    paymentRequestId?: string; // Link to PaymentRequest for tracking payment attempts
    externalOrderId?: string; // Gateway-specific order/subscription ID (e.g. PayPal I-xxxx)

    customerDetails?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    pricingId?: string;
    effectsAppliedAt?: Date;
}

export type T_Order_Populate = 'user' | 'pricing' | 'paymentTransaction';

export interface I_Input_QueryOrder extends Omit<I_Order, T_Order_Populate> { }
export interface I_Input_CreateOrder extends Omit<I_Order, T_Omit_Create | T_Order_Populate> {}
export interface I_Input_UpdateOrder extends Omit<I_Order, T_Omit_Update | T_Order_Populate> {}
