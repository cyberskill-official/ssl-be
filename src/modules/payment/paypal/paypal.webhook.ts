import type { Request, Response } from '@cyberskill/shared/node/express';

import { log } from '@cyberskill/shared/node/log';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';
import { emailCtr } from '#modules/email/index.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/env.util.js';

import { paypalCtr } from './paypal.controller.js';

export async function paypalWebhookHandler(req: Request, res: Response) {
    try {
        const env = getEnv();
        const webhookId = (env as any).PAYPAL_WEBHOOK_ID as string | undefined; // Cast to access unchecked env var

        // 1. Signature Verification
        const headers = req.headers;
        const transmissionId = headers['paypal-transmission-id'] as string;
        const transmissionTime = headers['paypal-transmission-time'] as string;
        const transmissionSig = headers['paypal-transmission-sig'] as string;
        const certUrl = headers['paypal-cert-url'] as string;
        const authAlgo = headers['paypal-auth-algo'] as string;

        const body = req.body;

        if (webhookId) {
            const context = { req };
            const verifyRes = await paypalCtr.verifyWebhookSignature(context, {
                auth_algo: authAlgo,
                cert_url: certUrl,
                transmission_id: transmissionId,
                transmission_sig: transmissionSig,
                transmission_time: transmissionTime,
                webhook_id: webhookId,
                webhook_event: body,
            });

            if (!verifyRes.success || verifyRes.result?.verification_status !== 'SUCCESS') {
                log.warn('[PayPal Webhook] Signature verification failed');
                res.status(400).send('Signature verification failed');
                return;
            }
        }
        else {
            log.warn('[PayPal Webhook] PAYPAL_WEBHOOK_ID not configured, skipping signature verification (INSECURE)');
        }

        const eventType = body.event_type;
        const resource = body.resource;

        log.info(`[PayPal Webhook] Received event: ${eventType}`, { id: body.id });

        switch (eventType) {
            case 'BILLING.SUBSCRIPTION.ACTIVATED':
                await handleSubscriptionActivated(resource);
                break;
            case 'PAYMENT.SALE.COMPLETED':
                await handlePaymentSaleCompleted(resource);
                break;
            case 'BILLING.SUBSCRIPTION.CANCELLED':
                await handleSubscriptionCancelled(resource);
                break;
            case 'BILLING.SUBSCRIPTION.SUSPENDED':
            case 'PAYMENT.SALE.DENIED':
                await handleSubscriptionSuspended(resource);
                break;
            default:
                log.info(`[PayPal Webhook] Unhandled event type: ${eventType}`);
        }

        res.status(200).send('OK');
    }
    catch (error) {
        log.error('[PayPal Webhook] Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
}

async function handleSubscriptionActivated(resource: any) {
    const subscriptionId = resource.id;
    const customId = resource.custom_id;
    log.info(`[PayPal Webhook] Subscription Activated: ${subscriptionId}`, { customId });
}

async function handlePaymentSaleCompleted(resource: any) {
    const subscriptionId = resource.billing_agreement_id;
    const amount = resource.amount?.total;
    const customId = resource.custom;

    log.info(`[PayPal Webhook] Payment Sale Completed for Subscription: ${subscriptionId}`, { amount });

    if (!subscriptionId)
        return;

    let userId = customId;
    if (!userId) {
        // Mock context for internal call
        const subRes = await paypalCtr.getSubscription({} as any, { subscriptionId });
        if (subRes.success && subRes.result) {
            // Access custom_id safely if definition includes it, otherwise cast
            const sub = subRes.result as any;
            userId = sub.custom_id;
        }
    }

    if (!userId) {
        log.error('[PayPal Webhook] Could not identify user for subscription payment', { subscriptionId });
        return;
    }

    const userRes = await userCtr.getUser({} as any, { filter: { id: userId } });
    if (!userRes.success || !userRes.result)
        return;
    const user = userRes.result;

    const currentExpiry = user.membershipExpiresAt && new Date(user.membershipExpiresAt) > new Date()
        ? new Date(user.membershipExpiresAt)
        : new Date();

    // Default to 30 days extension for now. Ideally fetch Plan frequency or Logic
    const newExpiry = new Date(currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);

    await userCtr.updateUser({} as any, {
        filter: { id: userId },
        update: {
            membershipExpiresAt: newExpiry,
        },
    });

    log.info(`[PayPal Webhook] Extended membership for user ${userId} to ${newExpiry}`);

    await emailCtr.sendEmail(PAYMENT_SUCCESS, user.email || '', {
        invoiceNo: `SUB-${subscriptionId.slice(-4)}`,
        paymentDate: new Date().toLocaleDateString(),
        userEmail: user.email,
        country: 'N/A',
        subtotal: amount,
        taxRate: '0',
        tax: '0',
        totalAmount: `${amount} (Auto-renewal)`,
        paymentMethod: 'PayPal Subscription',
        transactionId: resource.id,
        membershipPeriod: '1 Month',
        isRebill: true,
    });
}

async function handleSubscriptionCancelled(resource: any) {
    const subscriptionId = resource.id;
    const customId = resource.custom_id;
    log.info(`[PayPal Webhook] Subscription Cancelled: ${subscriptionId}`, { userId: customId });
}

async function handleSubscriptionSuspended(resource: any) {
    const subscriptionId = resource.id;
    log.warn(`[PayPal Webhook] Subscription Suspended/Denied: ${subscriptionId}`);
}
