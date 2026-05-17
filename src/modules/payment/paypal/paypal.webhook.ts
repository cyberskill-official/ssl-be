import type { Request, Response } from '@cyberskill/shared/node/express';

import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';
import { emailCtr } from '#modules/email/index.js';
import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import {
    E_MembershipEntitlementChangeReason,
    E_MembershipEntitlementChangeSource,
} from '#modules/payment/membership-entitlement-change/membership-entitlement-change.type.js';
import { paymentGatewayEventCtr } from '#modules/payment/payment-gateway-event/index.js';
import { E_PaymentGatewayEventProcessingStatus, E_PaymentGatewayEventVerificationStatus } from '#modules/payment/payment-gateway-event/payment-gateway-event.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { paymentSubscriptionCtr } from '#modules/payment/payment-subscription/payment-subscription.controller.js';
import {
    E_PaymentSubscriptionReplacementReason,
    E_PaymentSubscriptionSource,
    E_PaymentSubscriptionStatus,
} from '#modules/payment/payment-subscription/payment-subscription.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentTransactionSource, E_PaymentStatus as E_PaymentTransactionStatus } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/env.util.js';

import type { I_PayPalCaptureOrderResponse } from './paypal.type.js';

import { paypalCtr } from './paypal.controller.js';
import { buildPayPalSubscriptionPaymentEffectKey, getPayPalSubscriptionLastPayment } from './paypal.effect-key.js';

const env = getEnv();

function getHeaderString(value: unknown): string | undefined {
    if (Array.isArray(value)) {
        return value.find(item => typeof item === 'string');
    }
    return typeof value === 'string' ? value : undefined;
}

function getPayPalEventId(body: Record<string, any> | undefined, eventType: string, resource: Record<string, any> | undefined, transmissionId?: string): string {
    const id = body?.['id'];
    if (typeof id === 'string' && id.trim()) {
        return id.trim();
    }
    return [
        eventType || 'UNKNOWN',
        typeof resource?.['id'] === 'string' ? resource['id'] : undefined,
        transmissionId,
        new Date().toISOString(),
    ].filter(Boolean).join(':');
}

function resolvePayPalSubscriptionId(eventType: string, resource: Record<string, any> | undefined): string | null {
    const billingAgreementId = resource?.['billing_agreement_id'];
    if (typeof billingAgreementId === 'string' && billingAgreementId.trim()) {
        return billingAgreementId.trim();
    }

    const resourceId = resource?.['id'];
    if (eventType.startsWith('BILLING.SUBSCRIPTION.') && typeof resourceId === 'string' && resourceId.trim()) {
        return resourceId.trim();
    }

    return null;
}

function resolvePayPalTransactionId(eventType: string, resource: Record<string, any> | undefined): string | null {
    const resourceId = resource?.['id'];
    if (typeof resourceId !== 'string' || !resourceId.trim()) {
        return null;
    }

    if (eventType.startsWith('PAYMENT.') || eventType.startsWith('PAYMENTS.') || eventType.startsWith('CHECKOUT.ORDER.')) {
        return resourceId.trim();
    }

    return null;
}

function resolvePayPalUserId(resource: Record<string, any> | undefined): string | null {
    const customId = resource?.['custom_id'] ?? resource?.['custom'];
    return typeof customId === 'string' && customId.trim() ? customId.trim() : null;
}

function buildWebhookLogMeta(
    body: Record<string, any> | undefined,
    resource: Record<string, any> | undefined,
    headers?: {
        transmissionId?: string;
        transmissionTime?: string;
        certUrl?: string;
        authAlgo?: string;
        verificationStatus?: string;
        verifyMessage?: string;
    },
) {
    return {
        eventId: body?.['id'] ?? null,
        eventType: body?.['event_type'] ?? null,
        summary: body?.['summary'] ?? null,
        resourceId: resource?.['id'] ?? null,
        customId: resource?.['custom_id'] ?? resource?.['custom'] ?? null,
        billingAgreementId: resource?.['billing_agreement_id'] ?? null,
        webhookIdConfigured: Boolean(env.PAYPAL_WEBHOOK_ID),
        transmissionId: headers?.transmissionId ?? null,
        transmissionTime: headers?.transmissionTime ?? null,
        certUrl: headers?.certUrl ?? null,
        authAlgo: headers?.authAlgo ?? null,
        verificationStatus: headers?.verificationStatus ?? null,
        verifyMessage: headers?.verifyMessage ?? null,
    };
}

async function updateGatewayEvent(eventId: string | null | undefined, update: Record<string, unknown>): Promise<void> {
    if (!eventId) {
        return;
    }

    try {
        await paymentGatewayEventCtr.updatePaymentGatewayEvent({} as any, { id: eventId }, { $set: update });
    }
    catch (error) {
        log.warn('[PayPal Webhook] Failed to update payment gateway event audit record', { eventId, error });
    }
}

function getSubscriptionNextBillingTime(subscription: Record<string, any> | null | undefined): string | null {
    const value = subscription?.['billing_info']?.['next_billing_time'];
    return typeof value === 'string' ? value : null;
}

async function fetchSubscriptionSnapshot(subscriptionId: string, fallback: Record<string, any>): Promise<Record<string, any>> {
    try {
        const subRes = await paypalCtr.getSubscription({} as any, { subscriptionId });
        if (subRes.success && subRes.result) {
            return subRes.result as Record<string, any>;
        }
    }
    catch (error) {
        log.warn('[PayPal Webhook] Failed to fetch subscription snapshot; using webhook resource', {
            subscriptionId,
            error,
        });
    }
    return fallback;
}

async function cancelReplacedSubscriptionAfterSuccess(
    meta: Record<string, unknown> | null | undefined,
    replacementSubscriptionId: string,
) {
    const replacesSubscriptionId = typeof meta?.['replacesSubscriptionId'] === 'string'
        ? meta['replacesSubscriptionId']
        : null;
    if (!replacesSubscriptionId) {
        return;
    }

    const cancelRes = await paypalCtr.cancelSubscription({} as any, {
        subscriptionId: replacesSubscriptionId,
        reason: `Replaced by ${replacementSubscriptionId}`,
    });

    if (cancelRes.success) {
        await paymentSubscriptionCtr.linkReplacement(replacesSubscriptionId, replacementSubscriptionId);
        return;
    }

    await paymentSubscriptionCtr.markActionRequired(
        replacesSubscriptionId,
        cancelRes.message ?? `Failed to cancel replaced subscription ${replacesSubscriptionId}`,
    );
}

export async function paypalWebhookHandler(req: Request, res: Response) {
    try {
        const webhookId = env.PAYPAL_WEBHOOK_ID;

        // 1. Signature Verification
        const headers = req.headers;
        const transmissionId = getHeaderString(headers['paypal-transmission-id']);
        const transmissionTime = getHeaderString(headers['paypal-transmission-time']);
        const transmissionSig = getHeaderString(headers['paypal-transmission-sig']);
        const certUrl = getHeaderString(headers['paypal-cert-url']);
        const authAlgo = getHeaderString(headers['paypal-auth-algo']);

        const body = req.body;
        const resource = body?.['resource'] as Record<string, any> | undefined;
        const eventType = typeof body?.['event_type'] === 'string' ? body.event_type : 'UNKNOWN';
        const gatewayEventRecord = await paymentGatewayEventCtr.recordReceivedEvent({} as any, {
            provider: E_PaymentProvider.PAYPAL,
            eventId: getPayPalEventId(body, eventType, resource, transmissionId),
            eventType,
            resourceId: typeof resource?.['id'] === 'string' ? resource['id'] : null,
            subscriptionId: resolvePayPalSubscriptionId(eventType, resource),
            transactionId: resolvePayPalTransactionId(eventType, resource),
            userId: resolvePayPalUserId(resource),
            verificationStatus: E_PaymentGatewayEventVerificationStatus.PENDING,
            processingStatus: E_PaymentGatewayEventProcessingStatus.RECEIVED,
            headers: {
                transmissionId,
                transmissionTime,
                certUrl,
                authAlgo,
                webhookIdConfigured: Boolean(webhookId),
            },
            payload: body,
        });
        const gatewayEventId = gatewayEventRecord.event?.id ?? null;

        if (gatewayEventRecord.alreadyProcessed) {
            log.info('[PayPal Webhook] Duplicate already-processed event ignored', {
                eventId: gatewayEventRecord.event?.eventId,
                eventType,
            });
            res.status(200).send('OK');
            return;
        }

        if (webhookId) {
            const context = { req };
            const verifyRes = await paypalCtr.verifyWebhookSignature(context, {
                auth_algo: authAlgo ?? '',
                cert_url: certUrl ?? '',
                transmission_id: transmissionId ?? '',
                transmission_sig: transmissionSig ?? '',
                transmission_time: transmissionTime ?? '',
                webhook_id: webhookId,
                webhook_event: body,
            });
            const verificationStatus = verifyRes.success ? verifyRes.result?.verification_status : undefined;

            if (!verifyRes.success || verificationStatus !== 'SUCCESS') {
                await updateGatewayEvent(gatewayEventId, {
                    verificationStatus: E_PaymentGatewayEventVerificationStatus.FAILED,
                    processingStatus: E_PaymentGatewayEventProcessingStatus.FAILED,
                    errorMessage: verifyRes.message ?? 'Signature verification failed',
                    processedAt: new Date(),
                });
                log.warn('[PayPal Webhook] Signature verification failed', buildWebhookLogMeta(body, resource, {
                    transmissionId,
                    transmissionTime,
                    certUrl,
                    authAlgo,
                    verificationStatus,
                    verifyMessage: verifyRes.message,
                }));
                res.status(400).send('Signature verification failed');
                return;
            }

            await updateGatewayEvent(gatewayEventId, {
                verificationStatus: E_PaymentGatewayEventVerificationStatus.SUCCESS,
            });
        }
        else {
            await updateGatewayEvent(gatewayEventId, {
                verificationStatus: E_PaymentGatewayEventVerificationStatus.SKIPPED,
            });
            log.warn('[PayPal Webhook] PAYPAL_WEBHOOK_ID not configured, skipping signature verification (INSECURE)');
        }

        log.info('[PayPal Webhook] EventType & Resource:', { eventType, resource });
        log.info(`[PayPal Webhook] Received event: ${eventType}`, { id: body.id });

        await updateGatewayEvent(gatewayEventId, {
            processingStatus: E_PaymentGatewayEventProcessingStatus.PROCESSING,
        });

        switch (eventType) {
            case 'BILLING.SUBSCRIPTION.CREATED':
                log.info(
                    '[PayPal Webhook] Subscription created event received; no state changes are applied until activation/payment confirmation',
                    buildWebhookLogMeta(body, resource, {
                        transmissionId,
                        transmissionTime,
                    }),
                );
                break;
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
            case 'BILLING.SUBSCRIPTION.CANCELLED':
                await handleSubscriptionCancelled(resource);
                break;
            case 'BILLING.SUBSCRIPTION.SUSPENDED':
            case 'PAYMENT.SALE.DENIED':
                await handleSubscriptionSuspended(resource);
                break;
            default:
                log.warn('[PayPal Webhook] Unhandled event type received', buildWebhookLogMeta(body, resource, {
                    transmissionId,
                    transmissionTime,
                }));
        }

        await updateGatewayEvent(gatewayEventId, {
            processingStatus: E_PaymentGatewayEventProcessingStatus.PROCESSED,
            processedAt: new Date(),
        });

        res.status(200).send('OK');
    }
    catch (error) {
        const body = req.body as Record<string, any> | undefined;
        const resource = body?.['resource'] as Record<string, any> | undefined;
        const eventId = typeof body?.['id'] === 'string' ? body['id'] : null;

        if (eventId) {
            try {
                await paymentGatewayEventCtr.updatePaymentGatewayEvent({} as any, { provider: E_PaymentProvider.PAYPAL, eventId }, {
                    $set: {
                        processingStatus: E_PaymentGatewayEventProcessingStatus.FAILED,
                        errorMessage: error instanceof Error ? error.message : String(error),
                        processedAt: new Date(),
                    },
                });
            }
            catch {
                // Ignore audit update errors while returning the webhook failure.
            }
        }

        log.error('[PayPal Webhook] Error processing webhook:', {
            error,
            ...buildWebhookLogMeta(body, resource),
        });
        res.status(500).send('Internal Server Error');
    }
}

async function handleSubscriptionActivated(resource: any) {
    const subscriptionId = resource.id;
    const customId = resource.custom_id;
    log.info(`[PayPal Webhook] Subscription Activated: ${subscriptionId}`, { customId });
    const subscriptionSnapshot = await fetchSubscriptionSnapshot(subscriptionId, resource);

    // Update the payment request and order status to ensure polling reflects the activation
    try {
        const prRes = await paymentRequestCtr.getPaymentRequest({} as any, {
            filter: { externalOrderId: subscriptionId, gateway: E_PaymentProvider.PAYPAL },
        });
        log.info('[PayPal Webhook] handleSubscriptionActivated - PaymentRequest query result', { prRes });

        if (prRes.success && prRes.result) {
            const pr = prRes.result;
            const meta = pr.meta as Record<string, unknown> | null | undefined;
            const orderId = typeof meta?.['orderId'] === 'string' ? meta['orderId'] : undefined;
            const userId = customId || (typeof meta?.['userId'] === 'string' ? meta['userId'] : undefined);

            // Mark PaymentRequest as PAID
            log.info('[PayPal Webhook] handleSubscriptionActivated - Updating PaymentRequest to PAID', { paymentRequestId: pr.id });
            await paymentRequestCtr.updatePaymentRequest({} as any, {
                filter: { id: pr.id },
                update: { $set: { status: E_PaymentRequestStatus.PAID, gatewayResponse: subscriptionSnapshot } },
            });

            await paymentSubscriptionCtr.upsertFromProviderSnapshot({} as any, {
                provider: E_PaymentProvider.PAYPAL,
                providerSubscriptionId: subscriptionId,
                userId,
                paymentRequestId: pr.id,
                orderId,
                pricingId: typeof meta?.['pricingId'] === 'string' ? meta['pricingId'] : undefined,
                amount: typeof meta?.['amount'] === 'number' ? meta['amount'] : undefined,
                replacesSubscriptionId: typeof meta?.['replacesSubscriptionId'] === 'string' ? meta['replacesSubscriptionId'] : undefined,
                replacementReason: meta?.['replacementReason'] === E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                    ? E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                    : undefined,
                source: E_PaymentSubscriptionSource.WEBHOOK,
                providerSnapshot: subscriptionSnapshot,
            });

            // Note: We deliberately skip marking the Order as PAID here.
            // The Order will be marked PAID and effects (role, duration) will be applied
            // in handlePaymentSaleCompleted when the actual payment is confirmed.
            log.info(`[PayPal Webhook] Subscription activation received for ${subscriptionId}. Waiting for PAYMENT.SALE.COMPLETED to apply effects.`);
        }
    }
    catch (err) {
        log.warn('[PayPal Webhook] Failed to update payment records on activation:', { subscriptionId, error: err });
    }
}

async function handlePaymentSaleCompleted(resource: any) {
    const subscriptionId = resource.billing_agreement_id;
    const amount = resource.amount?.total;
    const customId = resource.custom;
    const saleTransactionId = typeof resource?.id === 'string' ? resource.id.trim() : '';

    log.info(`[PayPal Webhook] Payment Sale Completed for Subscription: ${subscriptionId}`, { amount, customId });

    if (!subscriptionId)
        return;

    // 1. Find and update PaymentRequest & Order to PAID/SUCCESS
    let userId = customId;
    let orderId: string | undefined;
    let paymentRequestId: string | undefined;
    let paymentRequestMeta: Record<string, unknown> | null | undefined;
    let subscriptionSnapshot: Record<string, any> = resource;

    try {
        const prRes = await paymentRequestCtr.getPaymentRequest({} as any, {
            filter: { externalOrderId: subscriptionId, gateway: E_PaymentProvider.PAYPAL },
        });
        log.info('[PayPal Webhook] handlePaymentSaleCompleted - PaymentRequest query result', { prRes });

        if (prRes.success && prRes.result) {
            const pr = prRes.result;
            paymentRequestId = pr.id;
            paymentRequestMeta = pr.meta as Record<string, unknown> | null | undefined;
            userId = userId || (pr.meta as any)?.userId;
            orderId = (pr.meta as any)?.orderId;
            subscriptionSnapshot = await fetchSubscriptionSnapshot(subscriptionId, resource);

            // Mark PaymentRequest as PAID
            log.info('[PayPal Webhook] handlePaymentSaleCompleted - Updating PaymentRequest to PAID', { paymentRequestId: pr.id });
            await paymentRequestCtr.updatePaymentRequest({} as any, {
                filter: { id: pr.id },
                update: { $set: { status: E_PaymentRequestStatus.PAID, gatewayResponse: subscriptionSnapshot } },
            });

            // If an Order is associated, mark it as PAID
            if (orderId) {
                log.info('[PayPal Webhook] handlePaymentSaleCompleted - Updating Order to PAID', { orderId });
                await orderCtr.updateOrder({} as any, {
                    filter: { id: orderId },
                    update: { $set: { status: E_OrderStatus.PAID } },
                });
                log.info(`[PayPal Webhook] Marked Order ${orderId} as PAID for subscription ${subscriptionId}`);
            }
        }
    }
    catch (err) {
        log.error('[PayPal Webhook] Error updating payment records for subscription sale:', err);
    }

    // 2. Identification Fallback (Old Logic)
    if (!userId && subscriptionId?.startsWith('I-')) {
        try {
            // Mock context for internal call
            const subRes = await paypalCtr.getSubscription({} as any, { subscriptionId });
            if (subRes.success && subRes.result) {
                const sub = subRes.result as any;
                userId = sub.custom_id;
            }
        }
        catch (err) {
            log.error('[PayPal Webhook] Error fetching subscription fallback:', err);
        }
    }

    if (!userId) {
        log.error('[PayPal Webhook] Could not identify user for subscription payment', { subscriptionId });
        return;
    }

    await paymentSubscriptionCtr.upsertFromProviderSnapshot({} as any, {
        provider: E_PaymentProvider.PAYPAL,
        providerSubscriptionId: subscriptionId,
        userId,
        paymentRequestId,
        orderId,
        pricingId: typeof paymentRequestMeta?.['pricingId'] === 'string' ? paymentRequestMeta['pricingId'] : undefined,
        amount: Number.isFinite(Number.parseFloat(String(amount ?? '')))
            ? Number.parseFloat(String(amount))
            : undefined,
        currency: typeof resource?.amount?.currency === 'string' ? resource.amount.currency : undefined,
        replacesSubscriptionId: typeof paymentRequestMeta?.['replacesSubscriptionId'] === 'string'
            ? paymentRequestMeta['replacesSubscriptionId']
            : undefined,
        replacementReason: paymentRequestMeta?.['replacementReason'] === E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
            ? E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
            : undefined,
        source: E_PaymentSubscriptionSource.WEBHOOK,
        providerSnapshot: subscriptionSnapshot,
    });

    let isDuplicateSaleEvent = false;
    if (saleTransactionId) {
        try {
            const existingSaleRes = await paymentCtr.getPaymentTransaction({} as any, {
                filter: {
                    provider: E_PaymentProvider.PAYPAL,
                    operation: E_PaymentGatewayOperation.SALE,
                    transactionId: saleTransactionId,
                },
            });

            if (existingSaleRes.success && existingSaleRes.result) {
                isDuplicateSaleEvent = true;
                log.info('[PayPal Webhook] Duplicate subscription sale event detected; skipping re-apply', {
                    subscriptionId,
                    saleTransactionId,
                    orderId,
                    userId,
                });
            }
            else {
                const paymentTransactionRes = await paymentCtr.recordGatewayTransaction({} as any, {
                    provider: E_PaymentProvider.PAYPAL,
                    operation: E_PaymentGatewayOperation.SALE,
                    transactionId: saleTransactionId,
                    userId,
                    orderId,
                    subscriptionId,
                    amount: Number.isFinite(Number.parseFloat(String(amount ?? '')))
                        ? Number.parseFloat(String(amount))
                        : undefined,
                    currency: typeof resource?.amount?.currency === 'string'
                        ? resource.amount.currency
                        : undefined,
                    status: E_PaymentTransactionStatus.SUCCESS,
                    success: true,
                    source: E_PaymentTransactionSource.WEBHOOK,
                    responsePayload: resource ?? null,
                    occurredAt: resource?.create_time ? new Date(resource.create_time) : new Date(),
                    performedAt: new Date(),
                });

                if (!paymentTransactionRes.success) {
                    log.warn('[PayPal Webhook] Failed to record subscription sale transaction; proceeding without durable dedupe', {
                        subscriptionId,
                        saleTransactionId,
                        message: paymentTransactionRes.message,
                    });
                }
            }
        }
        catch (err) {
            log.warn('[PayPal Webhook] Failed during subscription sale dedupe check; proceeding cautiously', {
                subscriptionId,
                saleTransactionId,
                error: err,
            });
        }
    }
    else {
        log.warn('[PayPal Webhook] Subscription sale missing resource.id; proceeding without durable dedupe', {
            subscriptionId,
            userId,
            orderId,
        });
    }

    // 3. Extend Membership and Apply Roles/Effects
    if (orderId) {
        try {
            const effectKey = buildPayPalSubscriptionPaymentEffectKey({
                subscriptionId,
                occurredAt: getPayPalSubscriptionLastPayment(subscriptionSnapshot).time ?? (typeof resource?.create_time === 'string' ? resource.create_time : null),
                amount: getPayPalSubscriptionLastPayment(subscriptionSnapshot).amount ?? amount,
                currency: getPayPalSubscriptionLastPayment(subscriptionSnapshot).currency ?? (typeof resource?.amount?.currency === 'string' ? resource.amount.currency : null),
                transactionId: saleTransactionId || null,
            });
            // Re-fetch order to ensure we have the latest state and populate pricing if needed
            // however applyOrderPaidEffects will fetch pricing from pricingCtr if only pricingId is present.
            const orderRes = await orderCtr.getOrder({} as any, { filter: { id: orderId } });
            if (orderRes.success && orderRes.result) {
                if (!isDuplicateSaleEvent) {
                    await applyOrderPaidEffects({} as any, orderRes.result, {
                        effectKey,
                        membershipPeriodStartAt: getPayPalSubscriptionLastPayment(subscriptionSnapshot).time ?? resource?.create_time,
                        membershipPeriodEndAt: getSubscriptionNextBillingTime(subscriptionSnapshot),
                        source: E_MembershipEntitlementChangeSource.WEBHOOK,
                        reason: paymentRequestMeta?.['replacementReason'] === E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                            ? E_MembershipEntitlementChangeReason.TOP_UP_REPLACEMENT
                            : E_MembershipEntitlementChangeReason.RENEWAL_PAYMENT,
                        paymentRequestId,
                        provider: E_PaymentProvider.PAYPAL,
                        providerSubscriptionId: subscriptionId,
                        transactionId: saleTransactionId || effectKey,
                    });
                    await cancelReplacedSubscriptionAfterSuccess(paymentRequestMeta, subscriptionId);
                    log.info(`[PayPal Webhook] Applied order paid effects for subscription ${subscriptionId}`, { userId, orderId, effectKey });
                }
            }
            else {
                log.error('[PayPal Webhook] Associated order not found for effects application', { orderId, subscriptionId });
            }
        }
        catch (err) {
            log.error('[PayPal Webhook] Error applying order effects for subscription sale:', err);
        }
    }
    else {
        log.warn('[PayPal Webhook] No orderId found for subscription sale; skipping legacy direct membership extension to avoid replay over-credit', {
            subscriptionId,
            userId,
        });
    }

    // 4. Send Email
    // Fetch fresh user data to reflect the updated expiry and ensure we have an email
    if (isDuplicateSaleEvent) {
        return;
    }

    const finalUserRes = await userCtr.getUser({} as any, { filter: { id: userId } });
    if (finalUserRes.success && finalUserRes.result && finalUserRes.result.email) {
        const user = finalUserRes.result;
        const userEmail = user.email as string;
        await emailCtr.sendEmail(PAYMENT_SUCCESS, userEmail, {
            invoiceNo: `SUB-${subscriptionId.slice(-4)}`,
            paymentDate: new Date().toLocaleDateString(),
            userEmail,
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

function normalizePayPalStatus(status: unknown): 'SUCCESS' | 'PENDING' | 'CANCEL' | 'FAILED' {
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

function shouldPreservePaymentRequestAfterSubscriptionCancel(status?: E_PaymentRequestStatus): boolean {
    if (status === E_PaymentRequestStatus.PAID || status === E_PaymentRequestStatus.REFUNDED) {
        return true;
    }
    return false;
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
    log.info('[PayPal Webhook] processPayPalOrderCapture', { paypalOrderId, captureResult, responsePayload });
    const paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
        filter: { externalOrderId: paypalOrderId, gateway: E_PaymentProvider.PAYPAL },
    });
    log.info('[PayPal Webhook] processPayPalOrderCapture - PaymentRequest query result', { paymentRequestRes });

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
    log.info('[PayPal Webhook] processPayPalOrderCapture - Order query result', { orderRes });
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
        // Skip capture for subscriptions - they don't use the capture flow
        if (paypalOrderId.startsWith('I-')) {
            log.warn('[PayPal Webhook] Skipping capture for subscription ID', { paypalOrderId });
            return;
        }
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
            userId: order.userId,
            orderId: order.id,
            paymentRequestId: paymentRequest.id,
            amount: typeof order.amount === 'number' ? order.amount : undefined,
            currency: capture?.amount?.currency_code,
            status: paymentStatus === 'SUCCESS'
                ? E_PaymentTransactionStatus.SUCCESS
                : paymentStatus === 'PENDING'
                    ? E_PaymentTransactionStatus.PENDING
                    : paymentStatus === 'CANCEL'
                        ? E_PaymentTransactionStatus.CANCELED
                        : E_PaymentTransactionStatus.FAILED,
            success: paymentStatus === 'SUCCESS',
            source: E_PaymentTransactionSource.WEBHOOK,
            errorCode: paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : undefined,
            errorMessage: paymentStatus === 'FAILED' ? 'Payment failed' : undefined,
            responsePayload: (resolvedCaptureResult as Record<string, unknown>) ?? null,
            occurredAt: new Date(),
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

    log.info('[PayPal Webhook] processPayPalOrderCapture - Updating order status', { orderId: order.id, orderStatus });
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

    log.info('[PayPal Webhook] processPayPalOrderCapture - Updating PaymentRequest status', { paymentRequestId: paymentRequest.id, paymentRequestStatus });
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
        const effectKey = transactionId ? `paypal:capture:${transactionId}` : null;
        const updatedOrderRes = await orderCtr.getOrder(context, {
            filter: { id: order.id },
            populate: [
                { path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] },
                { path: 'paymentTransaction' },
            ],
        });

        if (updatedOrderRes.success && updatedOrderRes.result) {
            try {
                await applyOrderPaidEffects(context, updatedOrderRes.result, { effectKey });
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
                            isRebill: false,
                        };

                        log.info('[PayPal Webhook] Sending payment success email', { userEmail, templateData });
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
    let customId = resource.custom_id;
    let paymentRequestId: string | null = null;
    let orderId: string | null = null;

    if (subscriptionId) {
        const prRes = await paymentRequestCtr.getPaymentRequest({} as any, {
            filter: { externalOrderId: subscriptionId, gateway: E_PaymentProvider.PAYPAL },
        });

        if (prRes.success && prRes.result) {
            const meta = prRes.result.meta as Record<string, unknown> | null | undefined;
            paymentRequestId = prRes.result.id ?? null;
            customId = customId || (typeof meta?.['userId'] === 'string' ? meta['userId'] : undefined);
            orderId = typeof meta?.['orderId'] === 'string' ? meta['orderId'] : null;

            if (!shouldPreservePaymentRequestAfterSubscriptionCancel(prRes.result.status)) {
                await paymentRequestCtr.updatePaymentRequest({} as any, {
                    filter: { id: prRes.result.id },
                    update: { $set: { status: E_PaymentRequestStatus.CANCELLED, gatewayResponse: resource } },
                });
            }
        }
    }

    log.info(`[PayPal Webhook] Subscription Cancelled: ${subscriptionId}`, { userId: customId, paymentRequestId, orderId });

    if (subscriptionId) {
        await paymentSubscriptionCtr.upsertFromProviderSnapshot({} as any, {
            provider: E_PaymentProvider.PAYPAL,
            providerSubscriptionId: subscriptionId,
            userId: customId,
            status: E_PaymentSubscriptionStatus.CANCELLED,
            providerStatus: 'CANCELLED',
            paymentRequestId: paymentRequestId ?? undefined,
            orderId: orderId ?? undefined,
            source: E_PaymentSubscriptionSource.WEBHOOK,
            providerSnapshot: resource,
        });
    }

    if (!customId) {
        log.warn('[PayPal Webhook] handleSubscriptionCancelled - Missing custom_id (userId)', { subscriptionId });
        return;
    }

    // Update user to mark membership as cancelled
    // This ensures they won't be rebilled, but keeps access until expiry
    try {
        const updateRes = await userCtr.updateUser({} as any, {
            filter: { id: customId },
            update: { membershipCancelled: true },
        });

        if (updateRes.success) {
            log.info(`[PayPal Webhook] Successfully marked membership as cancelled for user ${customId}`);
        }
        else {
            log.warn(`[PayPal Webhook] Failed to update user ${customId} membership status: ${updateRes.message}`);
        }
    }
    catch (error) {
        log.error(`[PayPal Webhook] Error updating user ${customId} for subscription cancellation:`, error);
    }
}

async function handleSubscriptionSuspended(resource: any) {
    const subscriptionId = resource.id;
    log.warn(`[PayPal Webhook] Subscription Suspended/Denied: ${subscriptionId}`);
    if (!subscriptionId) {
        return;
    }

    const prRes = await paymentRequestCtr.getPaymentRequest({} as any, {
        filter: { externalOrderId: subscriptionId, gateway: E_PaymentProvider.PAYPAL },
    });
    const meta = prRes.success ? prRes.result?.meta as Record<string, unknown> | null | undefined : undefined;

    await paymentSubscriptionCtr.upsertFromProviderSnapshot({} as any, {
        provider: E_PaymentProvider.PAYPAL,
        providerSubscriptionId: subscriptionId,
        userId: typeof resource?.custom_id === 'string'
            ? resource.custom_id
            : typeof meta?.['userId'] === 'string'
                ? meta['userId']
                : undefined,
        status: E_PaymentSubscriptionStatus.SUSPENDED,
        providerStatus: 'SUSPENDED',
        paymentRequestId: prRes.success ? prRes.result?.id : undefined,
        orderId: typeof meta?.['orderId'] === 'string' ? meta['orderId'] : undefined,
        source: E_PaymentSubscriptionSource.WEBHOOK,
        providerSnapshot: resource,
    });
}
