import { Router } from '@cyberskill/shared/node/express';

import type { I_Context } from '#shared/typescript/express.js';

import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { getEnv } from '#shared/env/index.js';

import { netvalveCtr } from './netvalve/netvalve.controller.js';
import { E_PaymentStatus } from './payment.type.js';

const env = getEnv();
const mainRouter = Router();

export function getPaymentUrls(clientOrderId?: string) {
    const env = getEnv();
    const baseUrl = env.USER_APP_URL.replace(/\/+$/, '');
    const redirectBase = env.PAYMENT_REDIRECT_URL || `${baseUrl}/payment`;

    // API base URL for payment callback endpoint
    const apiBaseUrl = env.ENDPOINT_RESTAPI || '/rest';
    const callbackBase = `${baseUrl}${apiBaseUrl}/payment`;

    // For SUCCESS: Call backend endpoint to process payment, then redirect to frontend
    // For other statuses: Redirect directly to frontend (no processing needed)
    const callbackParams = clientOrderId
        ? `?clientOrderId=${encodeURIComponent(clientOrderId)}&status=SUCCESS`
        : '?status=SUCCESS';
    const frontendRedirect = `&redirect=${encodeURIComponent(redirectBase)}`;

    return {
        successUrl: `${callbackBase}${callbackParams}${frontendRedirect}`,
        cancelUrl: `${redirectBase}?status=CANCEL${clientOrderId ? `&clientOrderId=${encodeURIComponent(clientOrderId)}` : ''}`,
        failedUrl: `${redirectBase}?status=FAILED${clientOrderId ? `&clientOrderId=${encodeURIComponent(clientOrderId)}` : ''}`,
        pendingUrl: `${redirectBase}?status=PENDING${clientOrderId ? `&clientOrderId=${encodeURIComponent(clientOrderId)}` : ''}`,
    };
}

// Payment callback endpoint - called by Netvalve redirect when payment is SUCCESS
// URL: /rest/payment?status=SUCCESS&transactionID=64558
// Processes membership extension or event creation, then redirects to frontend
mainRouter.get('/payment', async (req, res, next) => {
    try {
        const query = req.query as Record<string, unknown>;
        const clientOrderId = typeof query['clientOrderId'] === 'string' ? query['clientOrderId'].trim() : '';
        const status = typeof query['status'] === 'string' ? query['status'].toUpperCase() : '';
        const transactionID = typeof query['transactionID'] === 'string'
            ? query['transactionID'].trim()
            : typeof query['transactionID'] === 'number'
                ? String(query['transactionID'])
                : '';

        // Get frontend redirect URL (always use PAYMENT_REDIRECT_URL or default)
        const baseUrl = env.USER_APP_URL.replace(/\/+$/, '');
        const frontendRedirectUrl = env.PAYMENT_REDIRECT_URL || `${baseUrl}/payment`;

        // Only process if status is SUCCESS
        if (status !== 'SUCCESS') {
            res.redirect(`${frontendRedirectUrl}?status=${status}${transactionID ? `&transactionID=${encodeURIComponent(transactionID)}` : ''}`);
            return;
        }

        if (!clientOrderId && !transactionID) {
            res.status(400).json({ success: false, message: 'clientOrderId or transactionID is required' });
            return;
        }

        const resolvedClientOrderId = clientOrderId;
        const resolvedTransactionId = transactionID;

        if (!resolvedClientOrderId && !resolvedTransactionId) {
            res.status(400).json({ success: false, message: 'clientOrderId or transactionID is required' });
            return;
        }

        const context: I_Context = { req };

        // Find order by clientOrderId or transactionID (externalOrderId)
        let orderRes;
        if (resolvedClientOrderId) {
            orderRes = await orderCtr.getOrder(context, { filter: { clientOrderId: resolvedClientOrderId } });
        }
        else if (resolvedTransactionId) {
            orderRes = await orderCtr.getOrder(context, { filter: { externalOrderId: resolvedTransactionId } });
        }
        else {
            res.status(400).json({ success: false, message: 'clientOrderId or transactionID is required' });
            return;
        }

        if (!orderRes.success || !orderRes.result) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }

        const order = orderRes.result;

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
        const finalTransactionID = netvalveTransactionID || resolvedTransactionId || '';

        // Only process if order is not already PAID
        if (order.status === E_OrderStatus.PAID) {
            // Already processed, redirect to frontend
            res.redirect(`${frontendRedirectUrl}?status=SUCCESS&transactionID=${encodeURIComponent(finalTransactionID)}`);
            return;
        }

        // Verify payment is successful (PAID/SUCCESS from Netvalve)
        const isPaymentSuccess = netvalveOrderStatus === 'PAID' || netvalveOrderStatus === 'SUCCESS' || netvalveOrderStatus === E_PaymentStatus.SUCCESS;

        if (!isPaymentSuccess) {
            // Payment not confirmed, redirect to frontend with FAILED status
            res.redirect(`${frontendRedirectUrl}?status=FAILED&transactionID=${encodeURIComponent(finalTransactionID)}`);
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

        // Redirect to frontend with SUCCESS status
        res.redirect(`${frontendRedirectUrl}?status=SUCCESS&transactionID=${encodeURIComponent(finalTransactionID)}`);
    }
    catch (error) {
        next(error);
    }
});

export { mainRouter as paymentRouter };
