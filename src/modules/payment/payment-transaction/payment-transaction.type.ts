import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_PaymentProvider {
    NETVALVE = 'NETVALVE',
}

export enum E_PaymentStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELED = 'CANCELED',
    REFUNDED = 'REFUNDED',
    includes = 'includes',
}

export enum E_PaymentGatewayOperation {
    THREE_DS_INITIALIZATION = 'THREE_DS_INITIALIZATION',
    THREE_DS_AUTHENTICATION = 'THREE_DS_AUTHENTICATION',
    THREE_DS_RESULT = 'THREE_DS_RESULT',
    HPP_ORDER = 'HPP_ORDER',
    TOKEN_CREATE = 'TOKEN_CREATE',
    SALE = 'SALE',
    REFUND = 'REFUND',
    REBILL = 'REBILL',
    CAPTURE = 'CAPTURE',
    CANCEL = 'CANCEL',
    AUTHORIZE = 'AUTHORIZE',
    GET_TRANSACTION = 'GET_TRANSACTION',
    GET_TRANSACTIONS = 'GET_TRANSACTIONS',
    GET_ORDER = 'GET_ORDER',
    GET_ORDERS = 'GET_ORDERS',
    QUERY_TRANSACTION_STATUS = 'QUERY_TRANSACTION_STATUS',
}

export interface I_PaymentTransaction extends I_GenericDocument {
    provider?: E_PaymentProvider;
    operation?: E_PaymentGatewayOperation;
    transactionId?: string;
    orderId?: string;
    amount?: number;
    currencyId?: string;
    status?: E_PaymentStatus;
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    responsePayload?: Record<string, unknown> | null;
    performedAt?: Date;
}

export interface I_Input_QueryPaymentTransaction extends Partial<I_PaymentTransaction> {}

export interface I_Input_CreatePaymentTransaction extends Omit<I_PaymentTransaction, T_Omit_Create> {}

export interface I_Input_UpdatePaymentTransaction extends Omit<I_PaymentTransaction, T_Omit_Update> {}

export interface I_Input_RecordPaymentTransaction {
    provider: E_PaymentProvider;
    operation?: E_PaymentGatewayOperation;
    transactionId?: string;
    orderId?: string;
    amount?: number;
    currencyId?: string;
    status?: E_PaymentStatus;
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    responsePayload?: Record<string, unknown> | null;
    performedAt?: Date;
}
