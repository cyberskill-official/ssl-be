import type { NextFunction, Request, Response } from '@cyberskill/shared/node/express';
import type { I_Return } from '@cyberskill/shared/typescript';

import { Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';

import type { I_PayPalCaptureOrderResponse, I_PayPalPlanPayload, I_PayPalPlanResponse, I_PayPalProductPayload, I_PayPalProductResponse, I_PayPalSubscriptionPayload } from '#modules/payment/paypal/paypal.type.js';
import type { I_Context } from '#shared/typescript/express.js';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';
import { authnCtr } from '#modules/authn/index.js';
import { emailCtr } from '#modules/email/index.js';
import { E_EventType } from '#modules/event/event.type.js';
import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentStatus as E_PaymentTransactionStatus } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { paypalCtr } from '#modules/payment/paypal/paypal.controller.js';
import {
    E_PayPalProductCategory,
    E_PayPalProductStatus,
    E_PayPalProductType,
    E_PayPalShippingPreference,
    E_PayPalUserAction,
} from '#modules/payment/paypal/paypal.type.js';
import { paypalWebhookHandler } from '#modules/payment/paypal/paypal.webhook.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/env.util.js';

import { netvalveCtr } from './netvalve/netvalve.controller.js';
import { E_PaymentStatus } from './payment.type.js';

const mainRouter = Router();

mainRouter.post('/webhook/paypal', paypalWebhookHandler);

export function getPaymentUrls() {
    const env = getEnv();
    const baseUrl = env.USER_APP_URL.replace(/\/+$/, '');
    const redirectBase = env.PAYMENT_REDIRECT_URL ?? `${baseUrl}/payment`;

    return {
        // SUCCESS: Netvalve redirects directly to frontend, Netvalve will add transactionID to query
        // Format: PAYMENT_REDIRECT_URL?status=SUCCESS&transactionID={transactionID}
        successUrl: `${redirectBase}?status=SUCCESS`,
        // Other statuses: Redirect directly to frontend
        cancelUrl: `${redirectBase}?status=CANCEL`,
        failedUrl: `${redirectBase}?status=FAILED`,
        pendingUrl: `${redirectBase}?status=PENDING`,
    };
}

export function getPaymentRedirectBase() {
    const env = getEnv();
    const baseUrl = env.USER_APP_URL.replace(/\/+$/, '');
    return env.PAYMENT_REDIRECT_URL ?? `${baseUrl}/payment`;
}

mainRouter.get('/payment', async (req, res, next) => {
    try {
        const query = req.query as Record<string, unknown>;
        const transactionID = typeof query['transactionID'] === 'string'
            ? query['transactionID'].trim()
            : typeof query['transactionID'] === 'number'
                ? String(query['transactionID'])
                : '';
        const statusParam = typeof query['status'] === 'string' ? query['status'].toUpperCase().trim() : '';
        const normalizeId = (value: unknown): string | undefined => {
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
            if (typeof value === 'number' && Number.isFinite(value)) {
                return String(value);
            }
            return undefined;
        };

        log.info('[Payment Handler] Processing payment callback:', {
            transactionID,
            statusParam,
            query: JSON.stringify(query),
        });

        if (!transactionID) {
            log.warn('[Payment Handler] Missing transactionID');
            res.status(400).json({ success: false, message: 'transactionID is required' });
            return;
        }

        const context: I_Context = { req };

        // Find PaymentRequest by transactionID
        // transactionID can be either externalOrderId (Netvalve orderId) or transactionID from gatewayResponse
        let paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
            filter: { externalOrderId: transactionID },
        });

        // If not found by externalOrderId, try to find by transactionID in gatewayResponse
        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            log.info('[Payment Handler] PaymentRequest not found by externalOrderId, trying to find by transactionID in gatewayResponse:', { transactionID });
            // Query all PaymentRequests and filter by gatewayResponse.transactionID
            const allPaymentRequestsRes = await paymentRequestCtr.getPaymentRequests(context, {
                filter: { gateway: 'NETVALVE' },
                options: { limit: 100 },
            });

            if (allPaymentRequestsRes.success && allPaymentRequestsRes.result?.docs) {
                const foundPr = allPaymentRequestsRes.result.docs.find((pr) => {
                    const gatewayResponse = pr.gatewayResponse as Record<string, unknown> | null | undefined;
                    if (gatewayResponse && typeof gatewayResponse === 'object') {
                        const prTransactionID = gatewayResponse['transactionID'];
                        return prTransactionID === transactionID
                            || String(prTransactionID) === transactionID
                            || prTransactionID === Number(transactionID);
                    }
                    return false;
                });

                if (foundPr) {
                    paymentRequestRes = { success: true, result: foundPr };
                }
            }
        }

        // Fallback: resolve Netvalve order by transactionID, then map to PaymentRequest
        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            log.info('[Payment Handler] PaymentRequest not found by gatewayResponse, trying to resolve Netvalve order:', { transactionID });
            const netvalveOrderRes = await netvalveCtr.getOrder(context, { transactionId: transactionID });
            if (netvalveOrderRes.success && netvalveOrderRes.result) {
                const payload = netvalveOrderRes.result as Record<string, unknown>;
                const netvalveOrder = (payload['order'] as Record<string, unknown> | undefined) ?? payload;
                const orderId = normalizeId(netvalveOrder?.['orderId'] ?? netvalveOrder?.['id'] ?? netvalveOrder?.['orderID']);
                const clientOrderId = normalizeId(netvalveOrder?.['clientOrderId'] ?? netvalveOrder?.['clientOrderID']);

                if (orderId) {
                    log.info('[Payment Handler] Netvalve order resolved by transactionID:', { transactionID, orderId });
                    const prByExternalOrderId = await paymentRequestCtr.getPaymentRequest(context, {
                        filter: { externalOrderId: orderId },
                    });
                    if (prByExternalOrderId.success && prByExternalOrderId.result) {
                        paymentRequestRes = prByExternalOrderId;
                    }
                }

                if ((!paymentRequestRes.success || !paymentRequestRes.result) && clientOrderId) {
                    log.info('[Payment Handler] Netvalve order resolved by transactionID with clientOrderId:', {
                        transactionID,
                        clientOrderId,
                    });
                    const prByClientOrderId = await paymentRequestCtr.getPaymentRequest(context, {
                        filter: { 'meta.orderId': clientOrderId },
                    });
                    if (prByClientOrderId.success && prByClientOrderId.result) {
                        paymentRequestRes = prByClientOrderId;
                    }
                }
            }
        }

        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            log.warn('[Payment Handler] PaymentRequest not found:', { transactionID });
            res.status(404).json({ success: false, message: 'Payment request not found' });
            return;
        }

        const paymentRequest = paymentRequestRes.result;

        // Get orderId from PaymentRequest meta
        const meta = paymentRequest.meta as Record<string, unknown> | null | undefined;
        const orderId = meta && typeof meta === 'object' && typeof meta['orderId'] === 'string'
            ? meta['orderId']
            : null;

        if (!orderId) {
            log.warn('[Payment Handler] PaymentRequest has no orderId in meta:', { paymentRequestId: paymentRequest.id });
            res.status(404).json({ success: false, message: 'Order not found for payment request' });
            return;
        }

        // Find order by orderId from PaymentRequest meta
        const orderRes = await orderCtr.getOrder(context, { filter: { id: orderId } });

        if (!orderRes.success || !orderRes.result) {
            log.warn('[Payment Handler] Order not found:', { orderId, transactionID });
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }

        const order = orderRes.result;
        log.info('[Payment Handler] Order found:', {
            orderId: order.id,
            userId: order.userId,
            status: order.status,
            pricingId: order.pricingId,
        });

        // Only process if order is not already PAID
        if (order.status === E_OrderStatus.PAID) {
            log.info('[Payment Handler] Order already processed:', { orderId: order.id });
            res.status(200).json({ success: true, message: 'Order already processed', orderId: order.id });
            return;
        }

        // Try to get payment status from PaymentRequest.gatewayResponse first (most reliable, already available)
        let netvalveOrderStatus: string | undefined;
        let netvalveTransactionID: string | undefined;
        let netvalveResponseCode: string | undefined;

        // Extract status from PaymentRequest.gatewayResponse
        const gatewayResponse = paymentRequest.gatewayResponse as Record<string, unknown> | null | undefined;
        if (gatewayResponse && typeof gatewayResponse === 'object') {
            netvalveOrderStatus = typeof gatewayResponse['orderState'] === 'string' ? gatewayResponse['orderState'] : undefined;
            netvalveResponseCode = typeof gatewayResponse['responseCode'] === 'string' ? gatewayResponse['responseCode'] : undefined;
            const prTransactionID = gatewayResponse['transactionID'];
            netvalveTransactionID = typeof prTransactionID === 'string'
                ? prTransactionID
                : typeof prTransactionID === 'number'
                    ? String(prTransactionID)
                    : typeof gatewayResponse['transactionId'] === 'string'
                        ? gatewayResponse['transactionId']
                        : typeof gatewayResponse['transactionId'] === 'number'
                            ? String(gatewayResponse['transactionId'])
                            : transactionID;

            log.info('[Payment Handler] PaymentRequest.gatewayResponse found with status:', {
                orderState: netvalveOrderStatus,
                responseCode: netvalveResponseCode,
                transactionID: netvalveTransactionID,
            });
        }

        // Fallback: Query PaymentTransaction by transactionID to get status from responsePayload
        if (!netvalveOrderStatus && transactionID) {
            try {
                const paymentTransactionRes = await paymentCtr.getPaymentTransaction(context, {
                    filter: { transactionId: transactionID, provider: 'NETVALVE' },
                });

                if (paymentTransactionRes.success && paymentTransactionRes.result) {
                    const pt = paymentTransactionRes.result;
                    const responsePayload = pt.responsePayload as Record<string, unknown> | null | undefined;
                    const response = responsePayload && typeof responsePayload === 'object' && 'response' in responsePayload
                        ? responsePayload['response'] as Record<string, unknown>
                        : null;

                    if (response) {
                        netvalveOrderStatus = typeof response['orderState'] === 'string' ? response['orderState'] : undefined;
                        netvalveResponseCode = typeof response['responseCode'] === 'string' ? response['responseCode'] : undefined;
                        netvalveTransactionID = typeof response['transactionID'] === 'string'
                            ? response['transactionID']
                            : typeof response['transactionID'] === 'number'
                                ? String(response['transactionID'])
                                : typeof response['transactionId'] === 'string'
                                    ? response['transactionId']
                                    : typeof response['transactionId'] === 'number'
                                        ? String(response['transactionId'])
                                        : transactionID;

                        log.info('[Payment Handler] PaymentTransaction found with status:', {
                            orderState: netvalveOrderStatus,
                            responseCode: netvalveResponseCode,
                            transactionID: netvalveTransactionID,
                        });
                    }
                }
            }
            catch (error) {
                log.warn('[Payment Handler] Error querying PaymentTransaction:', { error, transactionID });
                // Continue to try Netvalve API query
            }
        }

        // Fallback: Query order from Netvalve API if PaymentTransaction doesn't have status
        if (!netvalveOrderStatus && paymentRequest.externalOrderId) {
            try {
                const netvalveOrderRes = await netvalveCtr.getOrder(context, { orderId: paymentRequest.externalOrderId });
                if (netvalveOrderRes.success && netvalveOrderRes.result) {
                    const netvalveOrder = netvalveOrderRes.result as Record<string, unknown>;
                    netvalveOrderStatus = typeof netvalveOrder['orderState'] === 'string' ? netvalveOrder['orderState'] : undefined;
                    netvalveResponseCode = typeof netvalveOrder['responseCode'] === 'string' ? netvalveOrder['responseCode'] : undefined;
                    // Get transactionID from Netvalve response
                    if (!netvalveTransactionID) {
                        netvalveTransactionID = typeof netvalveOrder['transactionID'] === 'string'
                            ? netvalveOrder['transactionID']
                            : typeof netvalveOrder['transactionID'] === 'number'
                                ? String(netvalveOrder['transactionID'])
                                : typeof netvalveOrder['transactionId'] === 'string'
                                    ? netvalveOrder['transactionId']
                                    : typeof netvalveOrder['transactionId'] === 'number'
                                        ? String(netvalveOrder['transactionId'])
                                        : transactionID;
                    }

                    log.info('[Payment Handler] Netvalve API order status:', {
                        orderState: netvalveOrderStatus,
                        responseCode: netvalveResponseCode,
                        transactionID: netvalveTransactionID,
                    });
                }
            }
            catch (error) {
                log.error('[Payment Handler] Error querying Netvalve API:', { error, externalOrderId: paymentRequest.externalOrderId });
                // Continue processing even if Netvalve query fails
            }
        }

        // Use transactionID from Netvalve response if available, otherwise use from query
        const finalTransactionID = netvalveTransactionID || transactionID;

        // Determine payment status from query param, Netvalve responseCode, or orderState
        // Priority: query param status (from Netvalve redirect) > responseCode (GTW_1000 = success) > orderState
        // IMPORTANT: When Netvalve redirects to successUrl, it means payment is SUCCESS, regardless of orderState
        let paymentStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCEL' | null = null;

        if (statusParam === 'SUCCESS' || statusParam === 'FAILED' || statusParam === 'PENDING' || statusParam === 'CANCEL') {
            // Trust the status from Netvalve redirect URL - this is the most reliable source
            // When Netvalve redirects to successUrl, payment is definitely SUCCESS
            paymentStatus = statusParam as 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCEL';
            log.info('[Payment Handler] Using status from query param (Netvalve redirect):', {
                statusParam,
                paymentStatus,
                note: 'Netvalve redirect URL is the most reliable source of payment status',
            });
        }
        else if (netvalveResponseCode) {
            // Use responseCode for more accurate status (GTW_1000 = success)
            if (netvalveResponseCode === 'GTW_1000') {
                // GTW_1000 means transaction approved, but check orderState to determine final status
                // Note: orderState "CREATED" means order is created but payment may still be processing
                // We should query Netvalve API to get latest orderState if statusParam is not available
                if (netvalveOrderStatus === 'PAID' || netvalveOrderStatus === 'SUCCESS') {
                    paymentStatus = 'SUCCESS';
                }
                else if (netvalveOrderStatus === 'CREATED' || netvalveOrderStatus === 'PENDING') {
                    paymentStatus = 'PENDING';
                }
                else {
                    paymentStatus = 'SUCCESS'; // Default to SUCCESS for GTW_1000 if orderState is unknown
                }
            }
            else {
                // Other response codes indicate failure
                paymentStatus = 'FAILED';
            }
        }
        else if (netvalveOrderStatus) {
            // Fallback: Map Netvalve orderState to our status
            if (netvalveOrderStatus === 'PAID' || netvalveOrderStatus === 'SUCCESS' || netvalveOrderStatus === E_PaymentStatus.SUCCESS) {
                paymentStatus = 'SUCCESS';
            }
            else if (netvalveOrderStatus === 'FAILED' || netvalveOrderStatus === E_PaymentStatus.FAILED) {
                paymentStatus = 'FAILED';
            }
            else if (netvalveOrderStatus === 'CREATED' || netvalveOrderStatus === 'PENDING' || netvalveOrderStatus === E_PaymentStatus.PENDING) {
                paymentStatus = 'PENDING';
            }
            else if (netvalveOrderStatus === 'CANCELLED' || netvalveOrderStatus === 'CANCELED' || netvalveOrderStatus === E_PaymentStatus.CANCELED) {
                paymentStatus = 'CANCEL';
            }
        }

        // If status is still unknown, default to FAILED for safety
        if (!paymentStatus) {
            log.warn('[Payment Handler] Unknown payment status, defaulting to FAILED:', {
                orderId: order.id,
                statusParam,
                netvalveOrderStatus,
                netvalveResponseCode,
            });
            paymentStatus = 'FAILED';
        }

        log.info('[Payment Handler] Payment status determined:', {
            orderId: order.id,
            paymentStatus,
            statusParam,
            netvalveOrderStatus,
        });

        // Update order status based on payment status
        let orderStatus: E_OrderStatus;
        let paymentRequestStatus: E_PaymentRequestStatus;

        switch (paymentStatus) {
            case 'SUCCESS':
                orderStatus = E_OrderStatus.PAID;
                paymentRequestStatus = E_PaymentRequestStatus.PAID;
                break;
            case 'FAILED':
                orderStatus = E_OrderStatus.FAILED;
                paymentRequestStatus = E_PaymentRequestStatus.FAILED;
                break;
            case 'PENDING':
                orderStatus = E_OrderStatus.PENDING;
                paymentRequestStatus = E_PaymentRequestStatus.PENDING;
                break;
            case 'CANCEL':
                orderStatus = E_OrderStatus.CANCELLED;
                paymentRequestStatus = E_PaymentRequestStatus.CANCELLED;
                break;
            default:
                orderStatus = E_OrderStatus.FAILED;
                paymentRequestStatus = E_PaymentRequestStatus.FAILED;
        }

        // Get or record PaymentTransaction with transactionId from Netvalve
        let paymentTransactionId: string | null = null;
        if (finalTransactionID) {
            try {
                // First, try to find existing PaymentTransaction
                let existingPaymentTransaction = null;
                const existingPtRes = await paymentCtr.getPaymentTransaction(context, {
                    filter: { transactionId: finalTransactionID, provider: 'NETVALVE' },
                });

                if (existingPtRes.success && existingPtRes.result) {
                    existingPaymentTransaction = existingPtRes.result;
                    paymentTransactionId = existingPaymentTransaction.id;
                    log.info('[Payment Handler] Using existing PaymentTransaction:', {
                        paymentTransactionId,
                        transactionId: finalTransactionID,
                    });
                }
                else {
                    // Record new PaymentTransaction if not exists
                    const paymentTransactionRes = await paymentCtr.recordGatewayTransaction(context, {
                        provider: E_PaymentProvider.NETVALVE,
                        operation: E_PaymentGatewayOperation.HPP_ORDER,
                        transactionId: finalTransactionID,
                        status: paymentStatus === 'SUCCESS'
                            ? E_PaymentTransactionStatus.SUCCESS
                            : paymentStatus === 'FAILED'
                                ? E_PaymentTransactionStatus.FAILED
                                : paymentStatus === 'PENDING'
                                    ? E_PaymentTransactionStatus.PENDING
                                    : E_PaymentTransactionStatus.CANCELED,
                        success: paymentStatus === 'SUCCESS',
                        errorCode: paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : undefined,
                        errorMessage: paymentStatus === 'FAILED' ? 'Payment failed' : undefined,
                        responsePayload: {
                            netvalveOrderStatus,
                            netvalveResponseCode,
                            transactionID: finalTransactionID,
                        },
                        performedAt: new Date(),
                    });

                    if (paymentTransactionRes.success && paymentTransactionRes.result) {
                        paymentTransactionId = paymentTransactionRes.result.id;
                        log.info('[Payment Handler] PaymentTransaction recorded:', {
                            paymentTransactionId,
                            transactionId: finalTransactionID,
                        });
                    }
                }
            }
            catch (error) {
                log.error('[Payment Handler] Failed to get/record PaymentTransaction:', {
                    error,
                    transactionID: finalTransactionID,
                });
                // Continue even if PaymentTransaction recording fails
            }
        }

        // Extract netvalveMidId from PaymentRequest.gatewayResponse or NetValve API response
        let netvalveMidId: string | undefined;

        // Try PaymentRequest.gatewayResponse first
        if (paymentRequest.gatewayResponse) {
            const gatewayResponse = paymentRequest.gatewayResponse as Record<string, unknown>;
            netvalveMidId = typeof gatewayResponse['netvalveMidId'] === 'string'
                ? gatewayResponse['netvalveMidId']
                : typeof gatewayResponse['midId'] === 'string'
                    ? gatewayResponse['midId']
                    : undefined;
        }

        // Fallback: Try NetValve API response if available
        if (!netvalveMidId && paymentRequest.externalOrderId) {
            try {
                const netvalveOrderRes = await netvalveCtr.getOrder(context, { orderId: paymentRequest.externalOrderId });
                if (netvalveOrderRes.success && netvalveOrderRes.result) {
                    const netvalveOrder = netvalveOrderRes.result as Record<string, unknown>;
                    netvalveMidId = typeof netvalveOrder['netvalveMidId'] === 'string'
                        ? netvalveOrder['netvalveMidId']
                        : typeof netvalveOrder['midId'] === 'string'
                            ? netvalveOrder['midId']
                            : undefined;
                }
            }
            catch (error) {
                log.warn('[Payment Handler] Failed to get netvalveMidId from NetValve API:', error);
            }
        }

        // Update order status, paymentTransactionId, and netvalveMidId
        log.info('[Payment Handler] Updating order status:', { orderId: order.id, orderStatus, paymentTransactionId, netvalveMidId });
        const updateOrderRes = await orderCtr.updateOrder(context, {
            filter: { id: order.id },
            update: {
                $set: {
                    status: orderStatus,
                    ...(paymentTransactionId && { paymentTransactionId }),
                    ...(netvalveMidId && { netvalveMidId }), // Save netvalveMidId to Order for rebill
                },
            },
        });

        if (!updateOrderRes.success) {
            log.error('[Payment Handler] Failed to update order status:', {
                orderId: order.id,
                error: updateOrderRes.message,
            });
            res.status(500).json({ success: false, message: 'Failed to update order status' });
            return;
        }

        // Update payment request status
        log.info('[Payment Handler] Updating payment request status:', {
            paymentRequestId: paymentRequest.id,
            paymentRequestStatus,
        });
        const updatePaymentRequestRes = await paymentRequestCtr.updatePaymentRequest(context, {
            filter: { id: paymentRequest.id },
            update: {
                $set: {
                    status: paymentRequestStatus,
                },
            },
        });
        if (!updatePaymentRequestRes.success) {
            log.error('[Payment Handler] Failed to update payment request status:', {
                paymentRequestId: paymentRequest.id,
                error: updatePaymentRequestRes.message,
            });
        }

        let paidEffectsResult: Awaited<ReturnType<typeof applyOrderPaidEffects>> | undefined;

        // Only apply order paid effects if payment is successful
        if (paymentStatus === 'SUCCESS') {
            log.info('[Payment Handler] Payment success - applying paid effects:', {
                orderId: order.id,
                paymentTransactionId,
            });
            // Reload order to get updated status
            const updatedOrderRes = await orderCtr.getOrder(context, {
                filter: { id: order.id },
                populate: [
                    { path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] },
                    { path: 'paymentTransaction' },
                ],
            });
            if (updatedOrderRes.success && updatedOrderRes.result) {
                // Apply order paid effects (membership extension or event creation)
                try {
                    paidEffectsResult = await applyOrderPaidEffects(context, updatedOrderRes.result);
                }
                catch (error) {
                    log.error('[Payment Handler] Error applying order paid effects:', {
                        orderId: updatedOrderRes.result.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    // Still return success to user, but log the error
                }

                // Send payment success email (no notification)
                if (order.userId) {
                    try {
                        const orderData = updatedOrderRes.result as any;
                        const pricing = orderData.pricing;
                        const paymentTransaction = orderData.paymentTransaction;

                        // Load user for email and location info
                        const userRes = await userCtr.getUser({}, {
                            filter: { id: order.userId },
                            populate: [
                                { path: 'partner1', populate: [{ path: 'location', populate: ['country'] }] },
                                { path: 'partner2', populate: [{ path: 'location', populate: ['country'] }] },
                            ],
                        });

                        if (userRes.success && userRes.result && userRes.result.email) {
                            const user = userRes.result;
                            const userEmail = user.email;

                            // Get country from user location or pricing
                            let country = '';
                            if (user.partner1?.location?.country?.name) {
                                country = user.partner1.location.country.name;
                            }
                            else if (user.partner2?.location?.country?.name) {
                                country = user.partner2.location.country.name;
                            }
                            else if (pricing?.country?.name) {
                                country = pricing.country.name;
                            }

                            // Format amounts
                            const amount = typeof orderData.amount === 'number' ? orderData.amount : 0;
                            const currencyCode = pricing?.currency?.code || 'EUR';
                            const taxRate = typeof pricing?.taxRate === 'number' ? pricing.taxRate : 0;
                            const baseAmount = amount / (1 + taxRate / 100);
                            const taxAmount = amount - baseAmount;

                            // Format payment date
                            const paymentDateObj = orderData.updatedAt ? new Date(orderData.updatedAt) : new Date();
                            const paymentDate = paymentDateObj.toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                            });

                            // Calculate membership period
                            let membershipPeriod = '';
                            if (user.membershipExpiresAt) {
                                const endDate = new Date(user.membershipExpiresAt);
                                const startDateStr = paymentDateObj.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                });
                                const endDateStr = endDate.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                });
                                membershipPeriod = `${startDateStr} - ${endDateStr}`;
                            }

                            // Get payment method
                            const paymentMethod = paymentTransaction?.method || 'Card';

                            // Generate short invoice number (4 characters from orderId)
                            const orderId = orderData.id || order.id;
                            const invoiceNo = orderId ? orderId.slice(-4).toUpperCase() : 'N/A';
                            const eventType = orderData?.meta?.event?.type as E_EventType | undefined;
                            const isClubVisit = eventType === E_EventType.CLUB_VISIT;
                            const eventTypeLabel = eventType === E_EventType.BOOTY_CALL
                                ? 'Booty Call'
                                : eventType === E_EventType.TRAVEL
                                    ? 'Travel'
                                    : eventType === E_EventType.PRIVATE
                                        ? 'Private'
                                        : 'Event';
                            const receiptDescription = pricing?.type === E_PricingType.ANNOUNCEMENT
                                ? `Announcements (${eventTypeLabel})`
                                : 'Membership';

                            // Build template data
                            const templateData = {
                                invoiceNo,
                                paymentDate,
                                userEmail,
                                country: country || 'N/A',
                                subtotal: `${baseAmount.toFixed(2)} ${currencyCode}`,
                                taxRate: taxRate.toFixed(0),
                                tax: taxAmount > 0 ? `${taxAmount.toFixed(2)} ${currencyCode}` : `0.00 ${currencyCode}`,
                                totalAmount: `${amount.toFixed(2)} ${currencyCode}`,
                                paymentMethod,
                                transactionId: paymentTransaction?.transactionId || orderData.paymentTransactionId || 'N/A',
                                membershipPeriod: membershipPeriod || 'N/A',
                                receiptDescription,
                                isRebill: false, // This is a manual payment, not an automatic rebill
                            };

                            // Send email directly (no notification)
                            if (pricing?.type !== E_PricingType.ANNOUNCEMENT || !isClubVisit) {
                                await emailCtr.sendEmail(PAYMENT_SUCCESS, userEmail ?? '', templateData);
                            }
                        }
                    }
                    catch (error) {
                        log.error('[Payment Handler] Error sending payment success email:', {
                            orderId: order.id,
                            userId: order.userId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        // Non-blocking: payment still succeeds even if email fails
                    }
                }
            }
            else {
                log.error('[Payment Handler] Failed to reload order for paid effects:', {
                    orderId: order.id,
                    error: updatedOrderRes.message,
                });
            }
        }

        res.status(200).json({
            success: paymentStatus === 'SUCCESS',
            message: paymentStatus === 'SUCCESS'
                ? 'Payment processed successfully'
                : `Payment ${paymentStatus.toLowerCase()}`,
            orderId: order.id,
            transactionID: finalTransactionID,
            status: paymentStatus,
            eventCreated: Boolean(paidEffectsResult?.event?.id),
            eventId: paidEffectsResult?.event?.id ?? null,
        });
    }
    catch (error) {
        log.error('[Payment Handler] Unexpected error:', { error });
        next(error);
    }
});

function resolvePayPalOrderId(req: Request): string | null {
    const body = req.body as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown> | undefined;

    const candidates: Array<unknown> = [
        body?.['orderId'],
        body?.['paypalOrderId'],
        body?.['token'],
        query?.['orderId'],
        query?.['paypalOrderId'],
        query?.['token'],
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim();
            if (trimmed) {
                return trimmed;
            }
        }
        else if (typeof candidate === 'number') {
            return String(candidate);
        }
    }

    return null;
}

async function handlePayPalCapture(req: Request, res: Response, next: NextFunction) {
    try {
        const paypalOrderId = resolvePayPalOrderId(req);

        if (!paypalOrderId) {
            res.status(400).json({ success: false, message: 'paypalOrderId is required' });
            return;
        }

        const context: I_Context = { req };

        const paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
            filter: { externalOrderId: paypalOrderId, gateway: E_PaymentProvider.PAYPAL },
        });

        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            res.status(404).json({ success: false, message: 'Payment request not found' });
            return;
        }

        const paymentRequest = paymentRequestRes.result;
        const meta = paymentRequest.meta as Record<string, unknown> | null | undefined;
        const orderId = meta && typeof meta === 'object' && typeof meta['orderId'] === 'string'
            ? meta['orderId']
            : null;

        if (!orderId) {
            res.status(404).json({ success: false, message: 'Order not found for payment request' });
            return;
        }

        const orderRes = await orderCtr.getOrder(context, { filter: { id: orderId } });

        if (!orderRes.success || !orderRes.result) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }

        const order = orderRes.result;

        if (order.status === E_OrderStatus.PAID) {
            res.status(200).json({ success: true, message: 'Order already processed', orderId: order.id });
            return;
        }

        const captureRes = await paypalCtr.captureOrder(context, { orderId: paypalOrderId });

        if (!captureRes.success || !captureRes.result) {
            res.status(typeof captureRes.code === 'number' ? captureRes.code : 502).json({
                success: false,
                message: captureRes.message ?? 'PayPal capture failed',
            });
            return;
        }

        const captureResult = captureRes.result as I_PayPalCaptureOrderResponse;
        const capture = captureResult.purchase_units?.[0]?.payments?.captures?.[0];
        const captureStatus = typeof capture?.status === 'string'
            ? capture.status
            : typeof captureResult.status === 'string'
                ? captureResult.status
                : '';
        const normalizedStatus = captureStatus.toUpperCase();

        let paymentStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCEL' = 'FAILED';

        if (normalizedStatus === 'COMPLETED') {
            paymentStatus = 'SUCCESS';
        }
        else if (normalizedStatus === 'PENDING') {
            paymentStatus = 'PENDING';
        }
        else if (normalizedStatus === 'VOIDED' || normalizedStatus === 'CANCELLED') {
            paymentStatus = 'CANCEL';
        }

        const transactionId = capture?.id || captureResult.id || paypalOrderId;

        let orderStatus: E_OrderStatus;
        let paymentRequestStatus: E_PaymentRequestStatus;

        switch (paymentStatus) {
            case 'SUCCESS':
                orderStatus = E_OrderStatus.PAID;
                paymentRequestStatus = E_PaymentRequestStatus.PAID;
                break;
            case 'PENDING':
                orderStatus = E_OrderStatus.PENDING;
                paymentRequestStatus = E_PaymentRequestStatus.PENDING;
                break;
            case 'CANCEL':
                orderStatus = E_OrderStatus.CANCELLED;
                paymentRequestStatus = E_PaymentRequestStatus.CANCELLED;
                break;
            default:
                orderStatus = E_OrderStatus.FAILED;
                paymentRequestStatus = E_PaymentRequestStatus.FAILED;
        }

        let paymentTransactionId: string | null = null;
        try {
            const paymentTransactionRes = await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.PAYPAL,
                operation: E_PaymentGatewayOperation.CAPTURE,
                transactionId,
                status: paymentStatus === 'SUCCESS'
                    ? E_PaymentTransactionStatus.SUCCESS
                    : paymentStatus === 'PENDING'
                        ? E_PaymentTransactionStatus.PENDING
                        : paymentStatus === 'CANCEL'
                            ? E_PaymentTransactionStatus.CANCELED
                            : E_PaymentTransactionStatus.FAILED,
                success: paymentStatus === 'SUCCESS',
                errorCode: paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : undefined,
                errorMessage: paymentStatus === 'FAILED' ? 'Payment failed' : undefined,
                responsePayload: (captureResult as Record<string, unknown>) ?? null,
                performedAt: new Date(),
            });

            if (paymentTransactionRes.success && paymentTransactionRes.result) {
                paymentTransactionId = paymentTransactionRes.result.id;
            }
        }
        catch (error) {
            log.error('[PayPal Capture] Failed to record PaymentTransaction:', {
                error,
                transactionId,
            });
        }

        const updateOrderRes = await orderCtr.updateOrder(context, {
            filter: { id: order.id },
            update: {
                $set: {
                    status: orderStatus,
                    ...(paymentTransactionId && { paymentTransactionId }),
                },
            },
        });

        if (!updateOrderRes.success) {
            res.status(500).json({ success: false, message: 'Failed to update order status' });
            return;
        }

        await paymentRequestCtr.updatePaymentRequest(context, {
            filter: { id: paymentRequest.id },
            update: {
                $set: {
                    status: paymentRequestStatus,
                    gatewayResponse: (captureResult as Record<string, unknown>) ?? null,
                },
            },
        });

        if (paymentStatus === 'SUCCESS') {
            const updatedOrderRes = await orderCtr.getOrder(context, {
                filter: { id: order.id },
                populate: [
                    { path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] },
                    { path: 'paymentTransaction' },
                ],
            });

            if (updatedOrderRes.success && updatedOrderRes.result) {
                try {
                    await applyOrderPaidEffects(context, updatedOrderRes.result);
                }
                catch (error) {
                    log.error('[PayPal Capture] Error applying order paid effects:', {
                        orderId: updatedOrderRes.result.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }

                if (order.userId) {
                    try {
                        const orderData = updatedOrderRes.result as any;
                        const pricing = orderData.pricing;
                        const paymentTransaction = orderData.paymentTransaction;

                        const userRes = await userCtr.getUser({}, {
                            filter: { id: order.userId },
                            populate: [
                                { path: 'partner1', populate: [{ path: 'location', populate: ['country'] }] },
                                { path: 'partner2', populate: [{ path: 'location', populate: ['country'] }] },
                            ],
                        });

                        if (userRes.success && userRes.result && userRes.result.email) {
                            const user = userRes.result;
                            const userEmail = user.email;

                            let country = '';
                            if (user.partner1?.location?.country?.name) {
                                country = user.partner1.location.country.name;
                            }
                            else if (user.partner2?.location?.country?.name) {
                                country = user.partner2.location.country.name;
                            }
                            else if (pricing?.country?.name) {
                                country = pricing.country.name;
                            }

                            const amount = typeof orderData.amount === 'number' ? orderData.amount : 0;
                            const currencyCode = pricing?.currency?.code || 'EUR';
                            const taxRate = typeof pricing?.taxRate === 'number' ? pricing.taxRate : 0;
                            const baseAmount = amount / (1 + taxRate / 100);
                            const taxAmount = amount - baseAmount;

                            const paymentDateObj = orderData.updatedAt ? new Date(orderData.updatedAt) : new Date();
                            const paymentDate = paymentDateObj.toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                            });

                            let membershipPeriod = '';
                            if (user.membershipExpiresAt) {
                                const endDate = new Date(user.membershipExpiresAt);
                                const startDateStr = paymentDateObj.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                });
                                const endDateStr = endDate.toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                });
                                membershipPeriod = `${startDateStr} - ${endDateStr}`;
                            }

                            const paymentMethod = paymentTransaction?.method || 'Card';

                            const orderIdValue = orderData.id || order.id;
                            const invoiceNo = orderIdValue ? orderIdValue.slice(-4).toUpperCase() : 'N/A';

                            const templateData = {
                                invoiceNo,
                                paymentDate,
                                userEmail,
                                country: country || 'N/A',
                                subtotal: `${baseAmount.toFixed(2)} ${currencyCode}`,
                                taxRate: taxRate.toFixed(0),
                                tax: taxAmount > 0 ? `${taxAmount.toFixed(2)} ${currencyCode}` : `0.00 ${currencyCode}`,
                                totalAmount: `${amount.toFixed(2)} ${currencyCode}`,
                                paymentMethod,
                                transactionId: paymentTransaction?.transactionId || orderData.paymentTransactionId || 'N/A',
                                membershipPeriod: membershipPeriod || 'N/A',
                                isRebill: false,
                            };

                            await emailCtr.sendEmail(PAYMENT_SUCCESS, userEmail ?? '', templateData);
                        }
                    }
                    catch (error) {
                        log.error('[PayPal Capture] Error sending payment success email:', {
                            orderId: order.id,
                            userId: order.userId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            }
        }

        res.status(200).json({
            success: paymentStatus === 'SUCCESS',
            message: paymentStatus === 'SUCCESS'
                ? 'Payment processed successfully'
                : `Payment ${paymentStatus.toLowerCase()}`,
            orderId: order.id,
            transactionId,
            status: paymentStatus,
        });
    }
    catch (error) {
        log.error('[PayPal Capture] Unexpected error:', { error });
        next(error);
    }
}

mainRouter.post('/payment/paypal/capture', handlePayPalCapture);
mainRouter.get('/payment/paypal/capture', handlePayPalCapture);

interface I_SubscriptionSetupBody {
    product?: I_PayPalProductPayload;
    plan?: Omit<I_PayPalPlanPayload, 'product_id'>;
    plan_id?: string;
    subscription?: Partial<I_PayPalSubscriptionPayload>;
}

function appendQueryParams(url: string, params: Record<string, string>): string {
    const query = new URLSearchParams(params).toString();
    if (!query)
        return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${query}`;
}

mainRouter.post('/payment/paypal/subscription/setup', async (req, res, next) => {
    try {
        const context: I_Context = { req };
        const currentUser = await authnCtr.getUserFromSession(context);
        if (!currentUser) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }

        const body = (req.body ?? {}) as I_SubscriptionSetupBody;
        const subscriptionInput = body.subscription ?? {};

        let planId = typeof body.plan_id === 'string' && body.plan_id.trim()
            ? body.plan_id.trim()
            : undefined;
        const planFromSubscription = typeof subscriptionInput.plan_id === 'string' && subscriptionInput.plan_id.trim()
            ? subscriptionInput.plan_id.trim()
            : undefined;
        planId = planId ?? planFromSubscription;

        let productResult: I_Return<I_PayPalProductResponse> | undefined;
        let planResult: I_Return<I_PayPalPlanResponse> | undefined;

        if (!planId) {
            if (!body.plan || !Array.isArray(body.plan.billing_cycles) || body.plan.billing_cycles.length === 0) {
                res.status(400).json({ success: false, message: 'billing_cycles is required when creating a PayPal plan' });
                return;
            }

            const productPayload: I_PayPalProductPayload = {
                name: 'Subscription Product',
                type: E_PayPalProductType.SERVICE,
                category: E_PayPalProductCategory.ADULT,
                ...body.product,
            };

            productResult = await paypalCtr.createProduct(context, productPayload);
            if (!productResult.success || !productResult.result?.id) {
                res.status(400).json({ success: false, message: productResult.message ?? 'Failed to create PayPal product' });
                return;
            }

            const planTemplate = body.plan;
            const planPayload: I_PayPalPlanPayload = {
                product_id: productResult.result.id,
                name: (planTemplate.name && planTemplate.name.trim()) || 'Subscription plan',
                description: planTemplate.description,
                billing_cycles: planTemplate.billing_cycles,
                payment_preferences: planTemplate.payment_preferences,
                taxes: planTemplate.taxes,
                status: planTemplate.status ?? E_PayPalProductStatus.ACTIVE,
            };

            planResult = await paypalCtr.createPlan(context, planPayload);
            if (!planResult.success || !planResult.result?.id) {
                res.status(400).json({ success: false, message: planResult.message ?? 'Failed to create PayPal plan' });
                return;
            }

            planId = planResult.result.id;

            if (planResult.result.status === 'CREATED') {
                const activateRes = await paypalCtr.activatePlan(context, { planId });
                if (!activateRes.success) {
                    res.status(400).json({ success: false, message: activateRes.message ?? 'Failed to activate PayPal plan' });
                    return;
                }
            }
        }

        if (!planId) {
            res.status(400).json({ success: false, message: 'plan_id is required to create a subscription' });
            return;
        }

        const subscriptionPayload: I_PayPalSubscriptionPayload = {
            ...subscriptionInput,
            plan_id: planId,
            custom_id: subscriptionInput.custom_id ?? currentUser.id,
        };

        if (!subscriptionPayload.subscriber) {
            const subscriber: Record<string, unknown> = {};
            if (currentUser.email) {
                subscriber['email_address'] = currentUser.email;
            }

            if (currentUser.username) {
                subscriber['name'] = {
                    given_name: currentUser.username,
                };
            }

            if (Object.keys(subscriber).length > 0) {
                subscriptionPayload.subscriber = subscriber;
            }
        }

        const redirectBase = getPaymentRedirectBase();
        const defaultAppContext = {
            user_action: E_PayPalUserAction.SUBSCRIBE_NOW,
            return_url: appendQueryParams(redirectBase, { status: 'SUCCESS', provider: E_PaymentProvider.PAYPAL, flow: 'subscription' }),
            cancel_url: appendQueryParams(redirectBase, { status: 'CANCEL', provider: E_PaymentProvider.PAYPAL, flow: 'subscription' }),
            shipping_preference: E_PayPalShippingPreference.NO_SHIPPING,
        };

        subscriptionPayload.application_context = {
            ...defaultAppContext,
            ...(subscriptionInput.application_context ?? {}),
        };

        const subscriptionRes = await paypalCtr.createSubscription(context, subscriptionPayload);
        if (!subscriptionRes.success || !subscriptionRes.result) {
            res.status(400).json({ success: false, message: subscriptionRes.message ?? 'Failed to create PayPal subscription' });
            return;
        }

        const approvalUrl = subscriptionRes.result.links?.find(link => link.rel === 'approve')?.href
            ?? subscriptionRes.result.links?.find(link => link.rel === 'payer-action')?.href;

        if (!approvalUrl) {
            res.status(400).json({ success: false, message: 'PayPal subscription response missing approval URL' });
            return;
        }

        const createdProduct = productResult?.success ? productResult.result : null;
        const createdPlan = planResult?.success ? planResult.result : null;

        res.status(200).json({
            success: true,
            result: {
                product: createdProduct,
                plan: createdPlan,
                subscription: subscriptionRes.result,
                approvalUrl,
            },
        });
    }
    catch (error) {
        log.error('[PayPal Subscription Setup] Unexpected error', error);
        next(error);
    }
});

export { mainRouter as paymentRouter };
