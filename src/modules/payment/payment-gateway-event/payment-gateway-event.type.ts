import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';

export enum E_PaymentGatewayEventProcessingStatus {
    RECEIVED = 'RECEIVED',
    PROCESSING = 'PROCESSING',
    PROCESSED = 'PROCESSED',
    FAILED = 'FAILED',
    IGNORED = 'IGNORED',
}

export enum E_PaymentGatewayEventVerificationStatus {
    PENDING = 'PENDING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    SKIPPED = 'SKIPPED',
}

export interface I_PaymentGatewayEvent extends I_GenericDocument {
    provider?: E_PaymentProvider;
    eventId?: string;
    eventType?: string;
    resourceId?: string | null;
    subscriptionId?: string | null;
    transactionId?: string | null;
    orderId?: string | null;
    paymentRequestId?: string | null;
    userId?: string | null;
    verificationStatus?: E_PaymentGatewayEventVerificationStatus;
    processingStatus?: E_PaymentGatewayEventProcessingStatus;
    receivedAt?: Date;
    processedAt?: Date | null;
    attemptCount?: number;
    errorMessage?: string | null;
    headers?: Record<string, unknown> | null;
    payload?: Record<string, unknown> | null;
}

export interface I_Input_QueryPaymentGatewayEvent extends Partial<I_PaymentGatewayEvent> {}
export interface I_Input_CreatePaymentGatewayEvent extends Omit<I_PaymentGatewayEvent, T_Omit_Create> {}
export interface I_Input_UpdatePaymentGatewayEvent extends Omit<I_PaymentGatewayEvent, T_Omit_Update> {}

export interface I_RecordPaymentGatewayEventResult {
    event: I_PaymentGatewayEvent | null;
    duplicate: boolean;
    alreadyProcessed: boolean;
}
