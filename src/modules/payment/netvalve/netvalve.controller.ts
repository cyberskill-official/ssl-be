import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_Netvalve3DSAuthenticationPayload,
    I_Netvalve3DSAuthenticationResponse,
    I_Netvalve3DSInitializationPayload,
    I_Netvalve3DSInitializationResponse,
    I_Netvalve3DSResultPayload,
    I_Netvalve3DSResultResponse,
    I_NetvalveAuthorizePayload,
    I_NetvalveAuthorizeResponse,
    I_NetvalveCancelPayload,
    I_NetvalveCancelResponse,
    I_NetvalveCapturePayload,
    I_NetvalveCaptureResponse,
    I_NetvalveCreateTokenPayload,
    I_NetvalveCreateTokenResponse,
    I_NetvalveGetOrderQuery,
    I_NetvalveGetOrderResponse,
    I_NetvalveGetOrdersQuery,
    I_NetvalveGetOrdersResponse,
    I_NetvalveGetTransactionQuery,
    I_NetvalveGetTransactionResponse,
    I_NetvalveGetTransactionsQuery,
    I_NetvalveGetTransactionsResponse,
    I_NetvalveHppOrderPayload,
    I_NetvalveHppOrderResponse,
    I_NetvalveQueryTransactionStatusQuery,
    I_NetvalveQueryTransactionStatusResponse,
    I_NetvalveRebillPayload,
    I_NetvalveRebillResponse,
    I_NetvalveRefundPayload,
    I_NetvalveRefundResponse,
    I_NetvalveSalePayload,
    I_NetvalveSaleResponse,
} from './netvalve.type.js';

import { E_PaymentGatewayOperation } from '../payment-transaction/payment-transaction.type.js';
import {
    NETVALVE_3DS_AUTHENTICATION_ENDPOINT,
    NETVALVE_3DS_INITIALIZATION_ENDPOINT,
    NETVALVE_3DS_RESULT_ENDPOINT,
    NETVALVE_AUTHORIZE_ENDPOINT,
    NETVALVE_CANCEL_ENDPOINT,
    NETVALVE_CAPTURE_ENDPOINT,
    NETVALVE_GET_ORDER_ENDPOINT,
    NETVALVE_GET_ORDERS_ENDPOINT,
    NETVALVE_GET_TRANSACTION_ENDPOINT,
    NETVALVE_GET_TRANSACTIONS_ENDPOINT,
    NETVALVE_HPP_ORDER_ENDPOINT,
    NETVALVE_QUERY_TRANSACTION_STATUS_ENDPOINT,
    NETVALVE_REBILL_ENDPOINT,
    NETVALVE_REFUND_ENDPOINT,
    NETVALVE_SALE_ENDPOINT,
    NETVALVE_TOKEN_CREATE_ENDPOINT,
} from './netvalve.constant.js';
import { applyHppMerchantRouting, applyMerchantRouting, ensureCredentials, postNetvalveGetRequest, postNetvalveHppRequest, postNetvalveRequest, recordNetvalveTransaction } from './netvalve.handler.js';

export const netvalveCtr = {
    createOrder: async (
        _context: I_Context,
        payload: I_NetvalveHppOrderPayload,
    ): Promise<I_Return<I_NetvalveHppOrderResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyHppMerchantRouting(payload, credentials);

        log.info('[Netvalve] Creating HPP order:', {
            hppBaseUrl: credentials.hppBaseUrl,
            baseUrl: credentials.baseUrl,
            endpoint: NETVALVE_HPP_ORDER_ENDPOINT,
            clientId: credentials.clientId,
            hasApiKey: !!credentials.apiKey,
            body: JSON.stringify(body),
        });

        const response = await postNetvalveHppRequest<I_NetvalveHppOrderResponse>(
            credentials,
            NETVALVE_HPP_ORDER_ENDPOINT,
            body,
            'hpp-order',
        );

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.HPP_ORDER, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    initialize3ds: async (
        _context: I_Context,
        payload: I_Netvalve3DSInitializationPayload,
    ): Promise<I_Return<I_Netvalve3DSInitializationResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_Netvalve3DSInitializationResponse>(
            credentials,
            NETVALVE_3DS_INITIALIZATION_ENDPOINT,
            body,
            '3ds-initialization',
        );

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.THREE_DS_INITIALIZATION, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    authenticate3ds: async (
        _context: I_Context,
        payload: I_Netvalve3DSAuthenticationPayload,
    ): Promise<I_Return<I_Netvalve3DSAuthenticationResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_Netvalve3DSAuthenticationResponse>(
            credentials,
            NETVALVE_3DS_AUTHENTICATION_ENDPOINT,
            body,
            '3ds-authentication',
        );

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.THREE_DS_AUTHENTICATION, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    result3ds: async (
        _context: I_Context,
        payload: I_Netvalve3DSResultPayload,
    ): Promise<I_Return<I_Netvalve3DSResultResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = { ...payload } as Record<string, unknown>;
        const response = await postNetvalveRequest<I_Netvalve3DSResultResponse>(
            credentials,
            NETVALVE_3DS_RESULT_ENDPOINT,
            body,
            '3ds-result',
        );

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.THREE_DS_RESULT, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    sale: async (
        _context: I_Context,
        payload: I_NetvalveSalePayload,
    ): Promise<I_Return<I_NetvalveSaleResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_NetvalveSaleResponse>(credentials, NETVALVE_SALE_ENDPOINT, body, 'sale');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.SALE, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    refund: async (
        _context: I_Context,
        payload: I_NetvalveRefundPayload,
    ): Promise<I_Return<I_NetvalveRefundResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_NetvalveRefundResponse>(credentials, NETVALVE_REFUND_ENDPOINT, body, 'refund');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.REFUND, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    rebill: async (
        _context: I_Context,
        payload: I_NetvalveRebillPayload,
    ): Promise<I_Return<I_NetvalveRebillResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_NetvalveRebillResponse>(credentials, NETVALVE_REBILL_ENDPOINT, body, 'rebill');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.REBILL, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    createToken: async (
        _context: I_Context,
        payload: I_NetvalveCreateTokenPayload,
    ): Promise<I_Return<I_NetvalveCreateTokenResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_NetvalveCreateTokenResponse>(credentials, NETVALVE_TOKEN_CREATE_ENDPOINT, body, 'token-create');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.TOKEN_CREATE, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    capture: async (
        _context: I_Context,
        payload: I_NetvalveCapturePayload,
    ): Promise<I_Return<I_NetvalveCaptureResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_NetvalveCaptureResponse>(credentials, NETVALVE_CAPTURE_ENDPOINT, body, 'capture');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.CAPTURE, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    cancel: async (
        _context: I_Context,
        payload: I_NetvalveCancelPayload,
    ): Promise<I_Return<I_NetvalveCancelResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_NetvalveCancelResponse>(credentials, NETVALVE_CANCEL_ENDPOINT, body, 'cancel');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.CANCEL, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    authorize: async (
        _context: I_Context,
        payload: I_NetvalveAuthorizePayload,
    ): Promise<I_Return<I_NetvalveAuthorizeResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const body = applyMerchantRouting(payload, credentials);
        const response = await postNetvalveRequest<I_NetvalveAuthorizeResponse>(credentials, NETVALVE_AUTHORIZE_ENDPOINT, body, 'authorize');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.AUTHORIZE, body, response as I_Return<Record<string, unknown>>);

        return response;
    },
    getTransaction: async (
        _context: I_Context,
        payload: I_NetvalveGetTransactionQuery,
    ): Promise<I_Return<I_NetvalveGetTransactionResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const response = await postNetvalveGetRequest<I_NetvalveGetTransactionResponse>(credentials, NETVALVE_GET_TRANSACTION_ENDPOINT, payload, 'get-transaction');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.GET_TRANSACTION, payload as Record<string, unknown>, response as I_Return<Record<string, unknown>>);

        return response;
    },
    getOrders: async (
        _context: I_Context,
        payload: I_NetvalveGetOrdersQuery,
    ): Promise<I_Return<I_NetvalveGetOrdersResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const response = await postNetvalveGetRequest<I_NetvalveGetOrdersResponse>(credentials, NETVALVE_GET_ORDERS_ENDPOINT, payload, 'get-orders');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.GET_ORDERS, payload as Record<string, unknown>, response as I_Return<Record<string, unknown>>);

        return response;
    },
    getOrder: async (
        _context: I_Context,
        payload: I_NetvalveGetOrderQuery,
    ): Promise<I_Return<I_NetvalveGetOrderResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const response = await postNetvalveGetRequest<I_NetvalveGetOrderResponse>(credentials, NETVALVE_GET_ORDER_ENDPOINT, payload, 'get-order');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.GET_ORDER, payload as Record<string, unknown>, response as I_Return<Record<string, unknown>>);

        return response;
    },
    queryTransactionStatus: async (
        _context: I_Context,
        payload: I_NetvalveQueryTransactionStatusQuery,
    ): Promise<I_Return<I_NetvalveQueryTransactionStatusResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const response = await postNetvalveGetRequest<I_NetvalveQueryTransactionStatusResponse>(credentials, NETVALVE_QUERY_TRANSACTION_STATUS_ENDPOINT, payload, 'query-transaction-status');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.QUERY_TRANSACTION_STATUS, payload as Record<string, unknown>, response as I_Return<Record<string, unknown>>);

        return response;
    },
    getTransactions: async (
        _context: I_Context,
        payload: I_NetvalveGetTransactionsQuery,
    ): Promise<I_Return<I_NetvalveGetTransactionsResponse>> => {
        const { credentials, error } = ensureCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'Netvalve credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const response = await postNetvalveGetRequest<I_NetvalveGetTransactionsResponse>(credentials, NETVALVE_GET_TRANSACTIONS_ENDPOINT, payload, 'get-transactions');

        await recordNetvalveTransaction(_context, E_PaymentGatewayOperation.GET_TRANSACTIONS, payload as Record<string, unknown>, response as I_Return<Record<string, unknown>>);

        return response;
    },
};
