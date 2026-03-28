import type { I_Input_CreateEvent } from '#modules/event/event.type.js';
import type { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';

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
    countryCode?: string; // countryCode (iso2) from FE geolocation IP (e.g., "VN", "DK")
    loc?: string; // Location string "latitude,longitude" from FE geolocation IP (e.g., "10.8230,106.6296")
    paymentProvider?: E_PaymentProvider;
}

export interface I_MakePaymentResult {
    orderId: string;
    amount: number;
    currencyCode: string;
    paymentMethod: E_PaymentMethod;
    paymentStatus: E_PaymentStatus;
    pricingId: string;
    redirectUrl?: string | null;
    clientToken?: string | null;
    paypalOrderId?: string | null;
    paypalClientId?: string | null;
    isSubscription: boolean;
}
