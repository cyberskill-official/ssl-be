import type { I_Order } from '#modules/order/order.type.js';
import type { I_Pricing } from '#modules/pricing/pricing.type.js';

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
    order?: I_Order;
    orderId?: string;
    cardName?: string;
    cardNumber?: string;
    cardExpiryMonth?: string;
    cardExpiryYear?: string;
    cardCvc?: string;
    paymentStatus?: E_PaymentStatus;
    paymentType?: E_PaymentMethod;
    pricingId?: string;
    pricing?: I_Pricing;
    clientOrderId?: string;
    eventPayload?: Record<string, unknown>;
}

export interface I_MakePaymentResult {
    orderId: string;
    amount: number;
    currencyCode: string;
    paymentMethod: E_PaymentMethod;
    paymentStatus: E_PaymentStatus;
    pricingId: string;
}
