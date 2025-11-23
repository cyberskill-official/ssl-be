import type { I_Event } from '#modules/event/event.type.js';
import type { E_OrderPaymentPurpose } from '#modules/order/order.type.js';
import type { E_NetvalvePaymentType } from '#modules/payment/netvalve/netvalve.type.js';

// Types specific to the payment module public API
export interface I_Input_MakePayment {
    amount?: number | string;
    currency?: string;
    clientOrderId?: string;
    successUrl?: string;
    cancelUrl?: string;
    failedUrl?: string;
    pendingUrl?: string;
    orderDesc?: string;
    midId?: string;
    customerDetails?: Record<string, unknown>;
    taxStateId?: string;
    taxCountryId?: string;
    paymentPurpose?: E_OrderPaymentPurpose;
    paymentType?: E_NetvalvePaymentType;
    token?: string;
    eventPayload?: Record<string, unknown>;
}

export enum E_MakePaymentResultStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
}

export interface I_MakePaymentResult {
    status: E_MakePaymentResultStatus;
    redirectUrl?: string | null;
    externalOrderId?: string | null;
    event?: I_Event | null;
    membershipExpiresAt?: Date | null;
    gatewayResponse?: Record<string, unknown> | null;
}
