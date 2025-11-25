import { Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/express.js';

import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
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
// URL: /rest/payment?transactionID=64592
// Processes membership extension or event creation, then returns JSON response
mainRouter.get('/payment', async (req, res, next) => {
    try {
        const query = req.query as Record<string, unknown>;
        const transactionID = typeof query['transactionID'] === 'string'
            ? query['transactionID'].trim()
            : typeof query['transactionID'] === 'number'
                ? String(query['transactionID'])
                : '';

        log.info('[Payment Handler] Processing payment callback:', { transactionID });

        if (!transactionID) {
            log.warn('[Payment Handler] Missing transactionID');
            res.status(400).json({ success: false, message: 'transactionID is required' });
            return;
        }

        const context: I_Context = { req };

        // Find PaymentRequest by transactionID (externalOrderId)
        const paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
            filter: { externalOrderId: transactionID },
        });

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

        // Query order from Netvalve to get transactionID and verify payment status
        let netvalveOrderStatus: string | undefined;
        let netvalveTransactionID: string | undefined;
        if (paymentRequest.externalOrderId) {
            try {
                const netvalveOrderRes = await netvalveCtr.getOrder(context, { orderId: paymentRequest.externalOrderId });
                if (netvalveOrderRes.success && netvalveOrderRes.result) {
                    const netvalveOrder = netvalveOrderRes.result as Record<string, unknown>;
                    netvalveOrderStatus = typeof netvalveOrder['orderState'] === 'string' ? netvalveOrder['orderState'] : undefined;
                    // Get transactionID from Netvalve response
                    netvalveTransactionID = typeof netvalveOrder['transactionID'] === 'string'
                        ? netvalveOrder['transactionID']
                        : typeof netvalveOrder['transactionID'] === 'number'
                            ? String(netvalveOrder['transactionID'])
                            : typeof netvalveOrder['transactionId'] === 'string'
                                ? netvalveOrder['transactionId']
                                : typeof netvalveOrder['transactionId'] === 'number'
                                    ? String(netvalveOrder['transactionId'])
                                    : undefined;

                    log.info('[Payment Handler] Netvalve order status:', {
                        orderState: netvalveOrderStatus,
                        transactionID: netvalveTransactionID,
                    });
                }
            }
            catch (error) {
                log.error('[Payment Handler] Error querying Netvalve:', { error, externalOrderId: paymentRequest.externalOrderId });
                // Continue processing even if Netvalve query fails
            }
        }

        // Use transactionID from Netvalve response if available, otherwise use from query
        const finalTransactionID = netvalveTransactionID || transactionID;

        // Verify payment is successful (PAID/SUCCESS from Netvalve)
        const isPaymentSuccess = netvalveOrderStatus === 'PAID' || netvalveOrderStatus === 'SUCCESS' || netvalveOrderStatus === E_PaymentStatus.SUCCESS;

        if (!isPaymentSuccess) {
            log.warn('[Payment Handler] Payment not confirmed by gateway:', {
                orderId: order.id,
                netvalveOrderStatus,
            });
            res.status(400).json({ success: false, message: 'Payment not confirmed by gateway' });
            return;
        }

        // Update order status to PAID
        log.info('[Payment Handler] Updating order status to PAID:', { orderId: order.id });
        const updateOrderRes = await orderCtr.updateOrder(context, {
            filter: { id: order.id },
            update: {
                $set: {
                    status: E_OrderStatus.PAID,
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

        // Reload order to get updated status
        const updatedOrderRes = await orderCtr.getOrder(context, { filter: { id: order.id } });
        if (updatedOrderRes.success && updatedOrderRes.result) {
            log.info('[Payment Handler] Applying order paid effects:', {
                orderId: updatedOrderRes.result.id,
                pricingId: updatedOrderRes.result.pricingId,
            });

            // Apply order paid effects (membership extension or event creation)
            try {
                await applyOrderPaidEffects(context, updatedOrderRes.result);
                log.success('[Payment Handler] Order paid effects applied successfully:', {
                    orderId: updatedOrderRes.result.id,
                });
            }
            catch (error) {
                log.error('[Payment Handler] Error applying order paid effects:', {
                    orderId: updatedOrderRes.result.id,
                    error,
                });
                // Still return success to user, but log the error
            }
        }
        else {
            log.error('[Payment Handler] Failed to reload order after update:', { orderId: order.id });
        }

        res.status(200).json({
            success: true,
            message: 'Payment processed successfully',
            orderId: order.id,
            transactionID: finalTransactionID,
        });
    }
    catch (error) {
        log.error('[Payment Handler] Unexpected error:', { error });
        next(error);
    }
});

export { mainRouter as paymentRouter };
