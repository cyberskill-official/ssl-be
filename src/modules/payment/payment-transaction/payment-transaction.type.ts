import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_PaymentProvider {
    PAYPAL = 'PAYPAL',
}

export enum E_PaymentStatus {
    PENDING = 'PENDING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    CANCELED = 'CANCELED',
    REFUNDED = 'REFUNDED',
}

export enum E_PaymentGatewayOperation {

    CREATE_ORDER = 'CREATE_ORDER',
    TOKEN_CREATE = 'TOKEN_CREATE',
    SALE = 'SALE',
    REFUND = 'REFUND',

    CAPTURE = 'CAPTURE',
    CANCEL = 'CANCEL',
    AUTHORIZE = 'AUTHORIZE',
    GET_TRANSACTION = 'GET_TRANSACTION',
    GET_TRANSACTIONS = 'GET_TRANSACTIONS',
    GET_ORDER = 'GET_ORDER',
    GET_ORDERS = 'GET_ORDERS',
    QUERY_TRANSACTION_STATUS = 'QUERY_TRANSACTION_STATUS',
}

export enum E_PaymentTransactionSource {
    CHECKOUT = 'CHECKOUT',
    WEBHOOK = 'WEBHOOK',
    STATUS_POLL = 'STATUS_POLL',
    ADMIN_SYNC = 'ADMIN_SYNC',
    RECONCILIATION = 'RECONCILIATION',
}

export interface I_PaymentTransaction extends I_GenericDocument {
    provider?: E_PaymentProvider;
    operation?: E_PaymentGatewayOperation;
    transactionId?: string;
    providerEventId?: string;
    userId?: string;
    orderId?: string;
    paymentRequestId?: string;
    subscriptionId?: string;
    amount?: number;
    currency?: string;
    status?: E_PaymentStatus;
    success: boolean;
    source?: E_PaymentTransactionSource;
    errorCode?: string;
    errorMessage?: string;
    responsePayload?: Record<string, unknown> | null;
    occurredAt?: Date;
    performedAt?: Date;
}

export interface I_Input_QueryPaymentTransaction extends Partial<I_PaymentTransaction> {}

export interface I_Input_CreatePaymentTransaction extends Omit<I_PaymentTransaction, T_Omit_Create> {}

export interface I_Input_UpdatePaymentTransaction extends Omit<I_PaymentTransaction, T_Omit_Update> {}

export interface I_Input_RecordPaymentTransaction extends Omit<I_PaymentTransaction, 'id' | 'createdAt' | 'updatedAt' | 'isDel'> {
}
