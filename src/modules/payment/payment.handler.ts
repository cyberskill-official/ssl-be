import { Router } from '@cyberskill/shared/node/express';

import type { I_Context } from '#shared/typescript/express.js';

import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { getEnv } from '#shared/env/index.js';

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
// URL: /rest/payment/process?transactionID=64558
// Processes membership extension or event creation, then returns JSON response
mainRouter.get('/payment', async (req, res, next) => {
    try {
        const query = req.query as Record<string, unknown>;
        const transactionID = typeof query['transactionID'] === 'string'
            ? query['transactionID'].trim()
            : typeof query['transactionID'] === 'number'
                ? String(query['transactionID'])
                : '';

        if (!transactionID) {
            res.status(400).json({ success: false, message: 'transactionID is required' });
            return;
        }

        const context: I_Context = { req };

        // Find order by transactionID (externalOrderId)
        const orderRes = await orderCtr.getOrder(context, { filter: { externalOrderId: transactionID } });

        if (!orderRes.success || !orderRes.result) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }

        const order = orderRes.result;

        // Only process if order is not already PAID
        if (order.status === E_OrderStatus.PAID) {
            res.status(200).json({ success: true, message: 'Order already processed', orderId: order.id });
            return;
        }

        // Query order from Netvalve to get transactionID and verify payment status
        let netvalveOrderStatus: string | undefined;
        let netvalveTransactionID: string | undefined;
        if (order.externalOrderId) {
            try {
                const netvalveOrderRes = await netvalveCtr.getOrder(context, { orderId: order.externalOrderId });
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
                }
            }
            catch {
                // Ignore errors when querying Netvalve
            }
        }

        // Use transactionID from Netvalve response if available, otherwise use from query
        const finalTransactionID = netvalveTransactionID || transactionID;

        // Verify payment is successful (PAID/SUCCESS from Netvalve)
        const isPaymentSuccess = netvalveOrderStatus === 'PAID' || netvalveOrderStatus === 'SUCCESS' || netvalveOrderStatus === E_PaymentStatus.SUCCESS;

        if (!isPaymentSuccess) {
            res.status(400).json({ success: false, message: 'Payment not confirmed by gateway' });
            return;
        }

        // Update order status to PAID
        await orderCtr.updateOrder(context, {
            filter: { id: order.id },
            update: {
                $set: {
                    status: E_OrderStatus.PAID,
                },
            },
        });

        // Reload order to get updated status
        const updatedOrderRes = await orderCtr.getOrder(context, { filter: { id: order.id } });
        if (updatedOrderRes.success && updatedOrderRes.result) {
            // Apply order paid effects (membership extension or event creation)
            await applyOrderPaidEffects(context, updatedOrderRes.result);
        }

        res.status(200).json({ success: true, message: 'Payment processed successfully', orderId: order.id, transactionID: finalTransactionID });
    }
    catch (error) {
        next(error);
    }
});

export { mainRouter as paymentRouter };
