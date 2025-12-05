import { Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/express.js';

import { E_NotificationChannel, E_NotificationEntityType, E_NotificationType, E_RedirectType, notificationCtr } from '#modules/notification/index.js';
import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentStatus as E_PaymentTransactionStatus } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { getEnv } from '#shared/env/env.util.js';

import { netvalveCtr } from './netvalve/netvalve.controller.js';
import { E_PaymentStatus } from './payment.type.js';

const mainRouter = Router();

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

// Payment processing endpoint - called by frontend after receiving transactionID from Netvalve redirect
// URL: /rest/payment?status=SUCCESS&transactionID=64592
// URL: /rest/payment?status=FAILED&transactionID=64592
// URL: /rest/payment?status=PENDING&transactionID=64592
// URL: /rest/payment?status=CANCEL&transactionID=64592
// Processes membership extension or event creation, then returns JSON response
mainRouter.get('/payment', async (req, res, next) => {
    try {
        const query = req.query as Record<string, unknown>;
        const transactionID = typeof query['transactionID'] === 'string'
            ? query['transactionID'].trim()
            : typeof query['transactionID'] === 'number'
                ? String(query['transactionID'])
                : '';
        const statusParam = typeof query['status'] === 'string' ? query['status'].toUpperCase().trim() : '';

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

        // Update order status and paymentTransactionId
        log.info('[Payment Handler] Updating order status:', { orderId: order.id, orderStatus, paymentTransactionId });
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
            log.error('[Payment Handler] Failed to update order status:', {
                orderId: order.id,
                error: updateOrderRes.message,
            });
            res.status(500).json({ success: false, message: 'Failed to update order status' });
            return;
        }

        // Update payment request status
        await paymentRequestCtr.updatePaymentRequest(context, {
            filter: { id: paymentRequest.id },
            update: {
                $set: {
                    status: paymentRequestStatus,
                },
            },
        });

        // Only apply order paid effects if payment is successful
        if (paymentStatus === 'SUCCESS') {
            // Reload order to get updated status
            const updatedOrderRes = await orderCtr.getOrder(context, { filter: { id: order.id } });
            if (updatedOrderRes.success && updatedOrderRes.result) {
                // Apply order paid effects (membership extension or event creation)
                try {
                    await applyOrderPaidEffects(context, updatedOrderRes.result);
                }
                catch (error) {
                    log.error('[Payment Handler] Error applying order paid effects:', {
                        orderId: updatedOrderRes.result.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    // Still return success to user, but log the error
                }

                // Create payment success notification (email-only, will include receipt)
                if (order.userId) {
                    try {
                        await notificationCtr.createNotificationWithSettings(context, {
                            doc: {
                                targetId: order.userId,
                                type: [E_NotificationType.PAYMENT_SUCCESS],
                                entityType: E_NotificationEntityType.PAYMENT,
                                entityId: order.id,
                                channels: [E_NotificationChannel.EMAIL], // Email-only for receipt
                                presentation: {
                                    redirect: {
                                        kind: E_RedirectType.PAYMENT,
                                        id: order.id,
                                    },
                                    headline: 'Your payment was successful!',
                                },
                            },
                        });
                    }
                    catch (error) {
                        log.error('[Payment Handler] Error creating payment success notification:', {
                            orderId: order.id,
                            userId: order.userId,
                            error: error instanceof Error ? error.message : String(error),
                        });
                        // Non-blocking: payment still succeeds even if notification fails
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
            transactionID: finalTransactionID,
            status: paymentStatus,
        });
    }
    catch (error) {
        log.error('[Payment Handler] Unexpected error:', { error });
        next(error);
    }
});

export { mainRouter as paymentRouter };
