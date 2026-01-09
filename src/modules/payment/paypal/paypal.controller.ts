import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_PayPalCaptureOrderResponse,
    I_PayPalCreateOrderPayload,
    I_PayPalCreateOrderResponse,
    I_PayPalPlanPayload,
    I_PayPalPlanResponse,
    I_PayPalProductPayload,
    I_PayPalProductResponse,
    I_PayPalSubscriptionPayload,
    I_PayPalSubscriptionResponse,
} from './paypal.type.js';

import { ensurePayPalCredentials, getPayPalRequest, postPayPalRequest } from './paypal.handler.js';

export const paypalCtr = {
    createOrder: async (
        _context: I_Context,
        payload: I_PayPalCreateOrderPayload,
    ): Promise<I_Return<I_PayPalCreateOrderResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        return postPayPalRequest<I_PayPalCreateOrderResponse>(
            credentials,
            '/v2/checkout/orders',
            payload as unknown as Record<string, unknown>,
            'create-order',
        );
    },
    captureOrder: async (
        _context: I_Context,
        { orderId }: { orderId: string },
    ): Promise<I_Return<I_PayPalCaptureOrderResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const safeOrderId = encodeURIComponent(orderId);

        return postPayPalRequest<I_PayPalCaptureOrderResponse>(
            credentials,
            `/v2/checkout/orders/${safeOrderId}/capture`,
            {},
            'capture-order',
        );
    },
    getOrder: async (
        _context: I_Context,
        { orderId }: { orderId: string },
    ): Promise<I_Return<I_PayPalCreateOrderResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const safeOrderId = encodeURIComponent(orderId);

        return getPayPalRequest<I_PayPalCreateOrderResponse>(
            credentials,
            `/v2/checkout/orders/${safeOrderId}`,
            'get-order',
        );
    },
    createProduct: async (
        _context: I_Context,
        payload: I_PayPalProductPayload,
    ): Promise<I_Return<I_PayPalProductResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        return postPayPalRequest<I_PayPalProductResponse>(
            credentials,
            '/v1/catalogs/products',
            payload as unknown as Record<string, unknown>,
            'create-product',
        );
    },
    createPlan: async (
        _context: I_Context,
        payload: I_PayPalPlanPayload,
    ): Promise<I_Return<I_PayPalPlanResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        return postPayPalRequest<I_PayPalPlanResponse>(
            credentials,
            '/v1/billing/plans',
            payload as unknown as Record<string, unknown>,
            'create-plan',
        );
    },
    createSubscription: async (
        _context: I_Context,
        payload: I_PayPalSubscriptionPayload,
    ): Promise<I_Return<I_PayPalSubscriptionResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        return postPayPalRequest<I_PayPalSubscriptionResponse>(
            credentials,
            '/v1/billing/subscriptions',
            payload as unknown as Record<string, unknown>,
            'create-subscription',
        );
    },
    getSubscription: async (
        _context: I_Context,
        { subscriptionId }: { subscriptionId: string },
    ): Promise<I_Return<I_PayPalSubscriptionResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const safeSubscriptionId = encodeURIComponent(subscriptionId);

        return getPayPalRequest<I_PayPalSubscriptionResponse>(
            credentials,
            `/v1/billing/subscriptions/${safeSubscriptionId}`,
            'get-subscription',
        );
    },
};

export default paypalCtr;
