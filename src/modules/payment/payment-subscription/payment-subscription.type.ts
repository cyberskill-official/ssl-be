import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_PaymentProvider } from '../payment-transaction/payment-transaction.type.js';

export enum E_PaymentSubscriptionStatus {
    PENDING_APPROVAL = 'PENDING_APPROVAL',
    APPROVAL_PENDING = 'APPROVAL_PENDING',
    SCHEDULED = 'SCHEDULED',
    ACTIVE = 'ACTIVE',
    PAST_DUE = 'PAST_DUE',
    SUSPENDED = 'SUSPENDED',
    CANCELLED = 'CANCELLED',
    EXPIRED = 'EXPIRED',
    ACTION_REQUIRED = 'ACTION_REQUIRED',
}

export enum E_PaymentSubscriptionReplacementReason {
    TOP_UP_REPLACEMENT = 'TOP_UP_REPLACEMENT',
    INITIAL_FUTURE_START = 'INITIAL_FUTURE_START',
    ADMIN_RECONCILIATION = 'ADMIN_RECONCILIATION',
}

export enum E_PaymentSubscriptionSource {
    CHECKOUT = 'CHECKOUT',
    WEBHOOK = 'WEBHOOK',
    STATUS_POLL = 'STATUS_POLL',
    RECONCILIATION = 'RECONCILIATION',
    ADMIN_SYNC = 'ADMIN_SYNC',
}

export interface I_PaymentSubscription extends I_GenericDocument {
    provider: E_PaymentProvider;
    providerSubscriptionId: string;
    userId?: string;
    status: E_PaymentSubscriptionStatus;
    providerStatus?: string;
    currentPeriodStartAt?: Date;
    currentPeriodEndAt?: Date;
    nextBillingAt?: Date;
    lastPaidAt?: Date;
    paymentRequestId?: string;
    orderId?: string;
    pricingId?: string;
    amount?: number;
    currency?: string;
    replacesSubscriptionId?: string;
    replacedBySubscriptionId?: string;
    replacementReason?: E_PaymentSubscriptionReplacementReason;
    nextReconcileAt?: Date;
    graceUntil?: Date;
    lastCheckedAt?: Date;
    lastError?: string;
    source?: E_PaymentSubscriptionSource;
    providerSnapshot?: Record<string, unknown>;
    meta?: Record<string, unknown>;
}

export interface I_Input_QueryPaymentSubscription extends Partial<I_PaymentSubscription> {
}

export interface I_Input_CreatePaymentSubscription extends Omit<I_PaymentSubscription, T_Omit_Create> {
}

export interface I_Input_UpdatePaymentSubscription extends Partial<Omit<I_PaymentSubscription, T_Omit_Update>> {
}

export interface I_Input_UpsertPaymentSubscriptionSnapshot {
    provider: E_PaymentProvider;
    providerSubscriptionId: string;
    userId?: string;
    status?: E_PaymentSubscriptionStatus;
    providerStatus?: string;
    paymentRequestId?: string;
    orderId?: string;
    pricingId?: string;
    amount?: number;
    currency?: string;
    replacesSubscriptionId?: string;
    replacedBySubscriptionId?: string;
    replacementReason?: E_PaymentSubscriptionReplacementReason;
    source?: E_PaymentSubscriptionSource;
    providerSnapshot?: Record<string, unknown>;
    meta?: Record<string, unknown>;
}
