import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_PayPalCaptureOrderResponse,
    I_PayPalCreateOrderPayload,
    I_PayPalCreateOrderResponse,
    I_PayPalListPlansResponse,
    I_PayPalListProductsResponse,
    I_PayPalPlanPayload,
    I_PayPalPlanResponse,
    I_PayPalProductPayload,
    I_PayPalProductResponse,
    I_PayPalSubscriptionPayload,
    I_PayPalSubscriptionResponse,
} from './paypal.type.js';

import { ensurePayPalCredentials, getPayPalRequest, postPayPalRequest } from './paypal.handler.js';
import { getBillingCyclesValidationError } from './paypal.validate.js';

function normalizePayPalBaseUrl(baseUrl: string, version: 'v1' | 'v2'): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    const withoutVersion = trimmed.replace(/\/(v1|v2)$/i, '');
    return `${withoutVersion}/${version}`;
}

function overridePayPalApiVersion(credentials: { baseUrl: string; clientId: string; clientSecret: string }, version: 'v1' | 'v2') {
    return {
        ...credentials,
        baseUrl: normalizePayPalBaseUrl(credentials.baseUrl, version),
    };
}

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
            '/checkout/orders',
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
            `/checkout/orders/${safeOrderId}/capture`,
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
            `/checkout/orders/${safeOrderId}`,
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

        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return postPayPalRequest<I_PayPalProductResponse>(
            v1Credentials,
            '/catalogs/products',
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

        const billingCyclesError = getBillingCyclesValidationError(payload.billing_cycles);
        if (billingCyclesError) {
            return {
                success: false,
                message: billingCyclesError,
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return postPayPalRequest<I_PayPalPlanResponse>(
            v1Credentials,
            '/billing/plans',
            payload as unknown as Record<string, unknown>,
            'create-plan',
        );
    },
    activatePlan: async (
        _context: I_Context,
        { planId }: { planId: string },
    ): Promise<I_Return<void>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const safePlanId = encodeURIComponent(planId);

        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return postPayPalRequest<void>(
            v1Credentials,
            `/billing/plans/${safePlanId}/activate`,
            null,
            'activate-plan',
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

        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return postPayPalRequest<I_PayPalSubscriptionResponse>(
            v1Credentials,
            '/billing/subscriptions',
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

        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return getPayPalRequest<I_PayPalSubscriptionResponse>(
            v1Credentials,
            `/billing/subscriptions/${safeSubscriptionId}`,
            'get-subscription',
        );
    },
    verifyWebhookSignature: async (
        _context: I_Context,
        payload: {
            auth_algo: string;
            cert_url: string;
            transmission_id: string;
            transmission_sig: string;
            transmission_time: string;
            webhook_id: string;
            webhook_event: Record<string, unknown>;
        },
    ): Promise<I_Return<{ verification_status: 'SUCCESS' | 'FAILURE' }>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return postPayPalRequest<{ verification_status: 'SUCCESS' | 'FAILURE' }>(
            v1Credentials,
            '/notifications/verify-webhook-signature',
            payload as unknown as Record<string, unknown>,
            'verify-webhook',
        );
    },
    listProducts: async (
        _context: I_Context,
    ): Promise<I_Return<I_PayPalListProductsResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return getPayPalRequest<I_PayPalListProductsResponse>(
            v1Credentials,
            '/catalogs/products',
            'list-products',
        );
    },
    listPlans: async (
        _context: I_Context,
        { productId }: { productId: string },
    ): Promise<I_Return<I_PayPalListPlansResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const safeProductId = encodeURIComponent(productId);
        const v1Credentials = overridePayPalApiVersion(credentials, 'v1');

        return getPayPalRequest<I_PayPalListPlansResponse>(
            v1Credentials,
            `/billing/plans?product_id=${safeProductId}`,
            'list-plans',
        );
    },
};

export default paypalCtr;
