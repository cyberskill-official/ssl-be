import type { I_Input_CreateEvent } from '#modules/event/event.type.js';

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
    event?: I_Input_CreateEvent; // Optional: event object for creating event after payment
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
