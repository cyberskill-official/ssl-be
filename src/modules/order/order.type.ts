import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Currency } from '#modules/location/currency/currency.type.js';

export enum E_OrderStatus {
    CREATED = 'CREATED',
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}

export enum E_OrderPaymentPurpose {
    MEMBERSHIP = 'MEMBERSHIP',
    EVENT_POST = 'EVENT_POST',
}

export interface I_Order extends I_GenericDocument {
    userId?: string;
    amount?: number;
    currency?: I_Currency;
    currencyId?: string;
    status?: E_OrderStatus;
    successUrl?: string;
    cancelUrl?: string;
    pendingUrl?: string;
    externalGateway?: string; // e.g. NETVALVE
    externalOrderId?: string; // gateway order id
    gatewayMidId?: string;
    clientOrderId?: string; // client's idempotency id
    customerDetails?: Record<string, unknown> | null;
    meta?: Record<string, unknown> | null;
    paymentPurpose?: E_OrderPaymentPurpose;
}

export interface I_Input_QueryOrder extends Partial<I_Order> {}
export interface I_Input_CreateOrder extends Omit<I_Order, T_Omit_Create> {}
export interface I_Input_UpdateOrder extends Omit<I_Order, T_Omit_Update> {}

export type T_Order_Populate = 'user';
