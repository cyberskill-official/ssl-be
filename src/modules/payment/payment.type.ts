import type { I_Event } from '#modules/event/event.type.js';

export enum E_PaymentStatus {
    PENDING = 'PENDING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    CANCELED = 'CANCELED',
    REFUNDED = 'REFUNDED',
}

export enum E_PaymentMethod {
    CARD = 'CARD',
    WALLET = 'WALLET',
    TOKEN = 'TOKEN',
}

export interface I_Input_MakePayment {
    pricingId?: string;
    event?: I_Event; // Optional: full event object for creating new event
    eventId?: string; // Optional: existing event ID to activate/update
}

export interface I_MakePaymentResult {
    orderId: string;
    amount: number;
    currencyCode: string;
    paymentMethod: E_PaymentMethod;
    paymentStatus: E_PaymentStatus;
    pricingId: string;
    redirectUrl?: string | null;
}
