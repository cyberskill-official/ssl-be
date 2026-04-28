import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import type {
    I_PayPalCaptureOrderResponse,
    I_PayPalClientTokenResponse,
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
        // Chỉ log thông tin liên quan captureOrder
        log.info('[PayPal][API][captureOrder]', { orderId });
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
        // Không log ở getOrder để tập trung debug capture
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

        const billingCyclesError = getBillingCyclesValidationError(payload.billing_cycles);
        if (billingCyclesError) {
            return {
                success: false,
                message: billingCyclesError,
                code: RESPONSE_STATUS.BAD_REQUEST.CODE,
            };
        }

        return postPayPalRequest<I_PayPalPlanResponse>(
            credentials,
            '/v1/billing/plans',
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

        return postPayPalRequest<void>(
            credentials,
            `/v1/billing/plans/${safePlanId}/activate`,
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
    cancelSubscription: async (
        _context: I_Context,
        { subscriptionId, reason }: { subscriptionId: string; reason?: string },
    ): Promise<I_Return<void>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const safeSubscriptionId = encodeURIComponent(subscriptionId);

        log.info('[PayPal][API][cancelSubscription]', { subscriptionId, reason });

        return postPayPalRequest<void>(
            credentials,
            `/v1/billing/subscriptions/${safeSubscriptionId}/cancel`,
            { reason: reason || 'Customer requested cancellation' },
            'cancel-subscription',
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

        return postPayPalRequest<{ verification_status: 'SUCCESS' | 'FAILURE' }>(
            credentials,
            '/v1/notifications/verify-webhook-signature',
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

        return getPayPalRequest<I_PayPalListProductsResponse>(
            credentials,
            '/v1/catalogs/products',
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

        return getPayPalRequest<I_PayPalListPlansResponse>(
            credentials,
            `/v1/billing/plans?product_id=${safeProductId}`,
            'list-plans',
        );
    },
    generateClientToken: async (
        _context: I_Context,
    ): Promise<I_Return<I_PayPalClientTokenResponse>> => {
        const { credentials, error } = ensurePayPalCredentials();

        if (!credentials) {
            return {
                success: false,
                message: error || 'PayPal credentials are misconfigured',
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        return postPayPalRequest<I_PayPalClientTokenResponse>(
            credentials,
            '/v1/identity/generate-token',
            {},
            'generate-client-token',
        );
    },
};

export default paypalCtr;
