import type { Request, Response } from '@cyberskill/shared/node/express';

import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';
import { emailCtr } from '#modules/email/index.js';
import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentStatus as E_PaymentTransactionStatus } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/env.util.js';

import type { I_PayPalCaptureOrderResponse } from './paypal.type.js';

import { paypalCtr } from './paypal.controller.js';

const env = getEnv();

export async function paypalWebhookHandler(req: Request, res: Response) {
    try {
        const webhookId = env.PAYPAL_WEBHOOK_ID;

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
            case 'CHECKOUT.ORDER.APPROVED':
                await handleCheckoutOrderApproved(req, resource);
                break;
            case 'CHECKOUT.ORDER.COMPLETED':
                await handleCheckoutOrderCompleted(req, resource);
                break;
            case 'PAYMENTS.CAPTURE.COMPLETED':
                await handlePaymentCaptureCompleted(req, resource);
                break;
            case 'BILLING.SUBSCRIPTION.PAYMENT.SUCCEEDED':
                await handleSubscriptionPaymentSucceeded(resource);
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
        receiptDescription: 'Membership Subscription',
        isRebill: true,
    });
}

function normalizePayPalStatus(status?: string): 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCEL' {
    const normalized = typeof status === 'string' ? status.toUpperCase() : '';
    if (normalized === 'COMPLETED') {
        return 'SUCCESS';
    }
    if (normalized === 'PENDING') {
        return 'PENDING';
    }
    if (normalized === 'VOIDED' || normalized === 'CANCELLED') {
        return 'CANCEL';
    }
    return 'FAILED';
}

function resolvePayPalOrderIdFromWebhook(resource: any): string | null {
    const fromRelated = resource?.supplementary_data?.related_ids?.order_id;
    if (typeof fromRelated === 'string' && fromRelated.trim()) {
        return fromRelated.trim();
    }
    const fromOrderId = resource?.order_id;
    if (typeof fromOrderId === 'string' && fromOrderId.trim()) {
        return fromOrderId.trim();
    }
    const fromId = resource?.id;
    if (typeof fromId === 'string' && fromId.trim()) {
        return fromId.trim();
    }
    return null;
}

function buildCaptureResultFromWebhook(paypalOrderId: string, resource: any): I_PayPalCaptureOrderResponse {
    const captureId = typeof resource?.id === 'string' ? resource.id : undefined;
    const captureStatus = typeof resource?.status === 'string' ? resource.status : undefined;

    return {
        id: paypalOrderId,
        status: captureStatus,
        purchase_units: [
            {
                payments: {
                    captures: [
                        {
                            id: captureId,
                            status: captureStatus,
                            amount: resource?.amount,
                        },
                    ],
                },
            },
        ],
    };
}

async function processPayPalOrderCapture(
    context: I_Context,
    {
        paypalOrderId,
        captureResult,
        responsePayload,
    }: {
        paypalOrderId: string;
        captureResult?: I_PayPalCaptureOrderResponse | null;
        responsePayload?: Record<string, unknown> | null;
    },
): Promise<void> {
    const paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
        filter: { externalOrderId: paypalOrderId, gateway: E_PaymentProvider.PAYPAL },
    });

    if (!paymentRequestRes.success || !paymentRequestRes.result) {
        log.warn('[PayPal Webhook] Payment request not found', { paypalOrderId });
        return;
    }

    const paymentRequest = paymentRequestRes.result;
    const meta = paymentRequest.meta as Record<string, unknown> | null | undefined;
    const orderId = meta && typeof meta === 'object' && typeof meta['orderId'] === 'string'
        ? meta['orderId']
        : null;

    if (!orderId) {
        log.warn('[PayPal Webhook] Order not found for payment request', { paypalOrderId, paymentRequestId: paymentRequest.id });
        return;
    }

    const orderRes = await orderCtr.getOrder(context, { filter: { id: orderId } });
    if (!orderRes.success || !orderRes.result) {
        log.warn('[PayPal Webhook] Order not found', { orderId, paypalOrderId });
        return;
    }

    const order = orderRes.result;
    if (order.status === E_OrderStatus.PAID) {
        log.info('[PayPal Webhook] Order already processed', { orderId, paypalOrderId });
        return;
    }

    let resolvedCaptureResult = captureResult ?? null;
    if (!resolvedCaptureResult) {
        const captureRes = await paypalCtr.captureOrder(context, { orderId: paypalOrderId });
        if (!captureRes.success || !captureRes.result) {
            log.error('[PayPal Webhook] PayPal capture failed', {
                paypalOrderId,
                message: captureRes.message,
            });
            return;
        }
        resolvedCaptureResult = captureRes.result as I_PayPalCaptureOrderResponse;
    }

    const capture = resolvedCaptureResult.purchase_units?.[0]?.payments?.captures?.[0];
    const captureStatus = typeof capture?.status === 'string'
        ? capture.status
        : typeof resolvedCaptureResult.status === 'string'
            ? resolvedCaptureResult.status
            : '';

    const paymentStatus = normalizePayPalStatus(captureStatus);
    const transactionId = capture?.id || resolvedCaptureResult.id || paypalOrderId;

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
            responsePayload: (resolvedCaptureResult as Record<string, unknown>) ?? null,
            performedAt: new Date(),
        });

        if (paymentTransactionRes.success && paymentTransactionRes.result) {
            paymentTransactionId = paymentTransactionRes.result.id;
        }
    }
    catch (error) {
        log.error('[PayPal Webhook] Failed to record PaymentTransaction:', {
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
        log.error('[PayPal Webhook] Failed to update order status', { orderId: order.id });
        return;
    }

    await paymentRequestCtr.updatePaymentRequest(context, {
        filter: { id: paymentRequest.id },
        update: {
            $set: {
                status: paymentRequestStatus,
                gatewayResponse: responsePayload ?? (resolvedCaptureResult as Record<string, unknown>) ?? null,
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
                log.error('[PayPal Webhook] Error applying order paid effects:', {
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

                        const paymentMethod = paymentTransaction?.method || 'PayPal';

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
                            receiptDescription: pricing?.type === E_PricingType.ANNOUNCEMENT ? 'Announcement' : 'Membership',
                            isRebill: false,
                        };

                        await emailCtr.sendEmail(PAYMENT_SUCCESS, userEmail ?? '', templateData);
                    }
                }
                catch (error) {
                    log.error('[PayPal Webhook] Error sending payment success email:', {
                        orderId: order.id,
                        userId: order.userId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
    }
}

async function handleCheckoutOrderApproved(req: Request, resource: any) {
    const paypalOrderId = resolvePayPalOrderIdFromWebhook(resource);
    if (!paypalOrderId) {
        log.warn('[PayPal Webhook] Missing order id for CHECKOUT.ORDER.APPROVED');
        return;
    }
    const context: I_Context = { req };
    await processPayPalOrderCapture(context, { paypalOrderId, responsePayload: resource });
}

async function handleCheckoutOrderCompleted(req: Request, resource: any) {
    const paypalOrderId = resolvePayPalOrderIdFromWebhook(resource);
    if (!paypalOrderId) {
        log.warn('[PayPal Webhook] Missing order id for CHECKOUT.ORDER.COMPLETED');
        return;
    }
    const context: I_Context = { req };
    const captureResult = buildCaptureResultFromWebhook(paypalOrderId, resource);
    await processPayPalOrderCapture(context, {
        paypalOrderId,
        captureResult,
        responsePayload: resource,
    });
}

async function handlePaymentCaptureCompleted(req: Request, resource: any) {
    const paypalOrderId = resolvePayPalOrderIdFromWebhook(resource);
    if (!paypalOrderId) {
        log.warn('[PayPal Webhook] Missing order id for PAYMENTS.CAPTURE.COMPLETED');
        return;
    }
    const context: I_Context = { req };
    const captureResult = buildCaptureResultFromWebhook(paypalOrderId, resource);
    await processPayPalOrderCapture(context, {
        paypalOrderId,
        captureResult,
        responsePayload: resource,
    });
}

async function handleSubscriptionCancelled(resource: any) {
    const subscriptionId = resource.id;
    const customId = resource.custom_id;
    log.info(`[PayPal Webhook] Subscription Cancelled: ${subscriptionId}`, { userId: customId });

    if (customId) {
        await userCtr.updateUser({} as any, {
            filter: { id: customId },
            update: {
                membershipCancelled: true,
            },
        });
        log.info(`[PayPal Webhook] Marked membership as cancelled for user ${customId}`);
    }
}

async function handleSubscriptionPaymentSucceeded(resource: any) {
    const subscriptionId = resource.billing_agreement_id;
    const amount = resource.amount?.total;
    // For Subscription API, it might be in billing_agreement_id or resource.id depending on event
    // The actual payment resource is what we need
    log.info(`[PayPal Webhook] Subscription Payment Succeeded: ${subscriptionId || resource.id}`, { amount });

    // SUBSCRIPTION.PAYMENT.SUCCEEDED resource is a payment capture-like object
    // but the subscription ID is in billing_agreement_id
    await handlePaymentSaleCompleted(resource);
}

async function handleSubscriptionSuspended(resource: any) {
    const subscriptionId = resource.id;
    log.warn(`[PayPal Webhook] Subscription Suspended/Denied: ${subscriptionId}`);
}
