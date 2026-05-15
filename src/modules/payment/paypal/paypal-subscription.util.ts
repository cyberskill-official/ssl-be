import { log } from '@cyberskill/shared/node/log';
import type { I_Context } from '#shared/typescript/index.js';
import orderCtr from '#modules/order/order.controller.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { paypalCtr } from '#modules/payment/paypal/paypal.controller.js';

const PAYPAL_SUBSCRIPTION_ID_REGEX = /^I-/;

/**
 * Cancel any active PayPal subscription for a user.
 * Best-effort: failures are logged but do not block the caller.
 * This MUST be called before deleting or deactivating a user to prevent
 * PayPal from continuing to charge the user after account removal.
 */
export async function cancelPayPalSubscriptionForUser(context: I_Context, userId: string): Promise<void> {
    try {
        // 1. Get all orders for this user to find associated payment requests
        const ordersRes = await orderCtr.getOrders(context, {
            filter: { userId },
            options: { pagination: false },
        });

        if (ordersRes.success && ordersRes.result?.docs?.length) {
            const orderIds = ordersRes.result.docs.map(o => o.id);

            // Find PayPal payment requests for these orders with a subscription ID (starts with I-)
            const paymentReqRes = await paymentRequestCtr.getPaymentRequests(context, {
                filter: {
                    'meta.orderId': { $in: orderIds },
                    'gateway': E_PaymentProvider.PAYPAL,
                    'externalOrderId': { $regex: PAYPAL_SUBSCRIPTION_ID_REGEX },
                } as any,
                options: { sort: { createdAt: -1 }, pagination: false },
            } as any);

            if (paymentReqRes.success && paymentReqRes.result?.docs?.length) {
                for (const pr of paymentReqRes.result.docs) {
                    const subscriptionId = pr.externalOrderId;
                    if (subscriptionId && PAYPAL_SUBSCRIPTION_ID_REGEX.test(subscriptionId)) {
                        await cancelSinglePayPalSubscription(context, userId, subscriptionId);
                    }
                }
            }
        }

        // 2. Fallback: search by userId stored directly in meta (in case meta.orderId is missing)
        const fallbackRes = await paymentRequestCtr.getPaymentRequests(context, {
            filter: {
                'gateway': E_PaymentProvider.PAYPAL,
                'externalOrderId': { $regex: PAYPAL_SUBSCRIPTION_ID_REGEX },
                '$or': [
                    { 'meta.userId': userId },
                    { 'meta.customId': userId },
                ],
            } as any,
            options: { sort: { createdAt: -1 }, pagination: false },
        } as any);

        if (fallbackRes.success && fallbackRes.result?.docs?.length) {
            for (const pr of fallbackRes.result.docs) {
                const subscriptionId = pr.externalOrderId;
                if (subscriptionId && PAYPAL_SUBSCRIPTION_ID_REGEX.test(subscriptionId)) {
                    await cancelSinglePayPalSubscription(context, userId, subscriptionId);
                }
            }
        }
    } catch (error) {
        log.error(`[PAYPAL-UTIL] Error cancelling PayPal subscription for user ${userId}:`, error);
        // Best-effort: do not block deletion
    }
}

async function cancelSinglePayPalSubscription(context: I_Context, userId: string, subscriptionId: string): Promise<void> {
    try {
        // Check if subscription is still active before attempting cancel
        const subRes = await paypalCtr.getSubscription(context, { subscriptionId });
        if (!subRes.success) {
            log.warn(`[PAYPAL-UTIL] Could not fetch PayPal subscription ${subscriptionId} for user ${userId}: ${subRes.message}`);
            return;
        }

        const subStatus = (subRes.result as any)?.status;
        if (subStatus === 'CANCELLED' || subStatus === 'EXPIRED') {
            log.info(`[PAYPAL-UTIL] PayPal subscription ${subscriptionId} already ${subStatus} for user ${userId}`);
            return;
        }

        const cancelRes = await paypalCtr.cancelSubscription(context, {
            subscriptionId,
            reason: 'User account deactivated or deleted',
        });

        if (cancelRes.success) {
            log.success(`[PAYPAL-UTIL] Successfully cancelled PayPal subscription ${subscriptionId} for user ${userId}`);
        } else {
            log.error(`[PAYPAL-UTIL] Failed to cancel PayPal subscription ${subscriptionId} for user ${userId}: ${cancelRes.message}`);
        }
    } catch (error) {
        log.error(`[PAYPAL-UTIL] Exception while cancelling PayPal subscription ${subscriptionId} for user ${userId}:`, error);
    }
}
