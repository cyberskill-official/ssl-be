import type { NextFunction, Request, Response } from '@cyberskill/shared/node/express';
import type { I_Return } from '@cyberskill/shared/typescript';

import { Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';

import type { I_PayPalCaptureOrderResponse, I_PayPalPlanPayload, I_PayPalPlanResponse, I_PayPalProductPayload, I_PayPalProductResponse, I_PayPalSubscriptionPayload } from '#modules/payment/paypal/paypal.type.js';
import type { I_Context } from '#shared/typescript/express.js';

import { PAYMENT_SUCCESS } from '#modules/authn/authn.constant.js';
import { authnCtr } from '#modules/authn/index.js';
import { emailCtr } from '#modules/email/index.js';
import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus, E_OrderType } from '#modules/order/order.type.js';
import {
    E_MembershipEntitlementChangeReason,
    E_MembershipEntitlementChangeSource,
} from '#modules/payment/membership-entitlement-change/membership-entitlement-change.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import {
    paymentSubscriptionCtr,
    resolvePaymentSubscriptionPeriodWindow,
} from '#modules/payment/payment-subscription/payment-subscription.controller.js';
import {
    E_PaymentSubscriptionReplacementReason,
    E_PaymentSubscriptionSource,
} from '#modules/payment/payment-subscription/payment-subscription.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentTransactionSource, E_PaymentStatus as E_PaymentTransactionStatus } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { paypalCtr } from '#modules/payment/paypal/paypal.controller.js';
import { buildPayPalSubscriptionPaymentEffectKey, getPayPalSubscriptionLastPayment } from '#modules/payment/paypal/paypal.effect-key.js';
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

const mainRouter = Router();
const TRAILING_SLASHES_REGEX = /\/+$/;

mainRouter.post('/webhook/paypal', paypalWebhookHandler);

function syncPaymentSessionUser(req: Request, orderUserId: string | undefined, latestUser: Record<string, any> | null) {
    const sessionUser = (req.session as any)?.user as Record<string, any> | undefined;
    if (!orderUserId || sessionUser?.['id'] !== orderUserId || !latestUser) {
        return;
    }

    sessionUser['membershipExpiresAt'] = latestUser['membershipExpiresAt'] ?? null;
    sessionUser['rolesIds'] = latestUser['rolesIds'] ?? sessionUser['rolesIds'];
    sessionUser['registerStep'] = latestUser['registerStep'] ?? sessionUser['registerStep'];
    sessionUser['membershipCancelled'] = latestUser['membershipCancelled'] ?? sessionUser['membershipCancelled'];
    if (typeof latestUser['freeEventCount'] === 'number') {
        sessionUser['freeEventCount'] = latestUser['freeEventCount'];
    }
}

async function cancelReplacedSubscriptionAfterSuccess(
    context: I_Context,
    meta: Record<string, unknown> | null | undefined,
    replacementSubscriptionId: string,
) {
    const replacesSubscriptionId = typeof meta?.['replacesSubscriptionId'] === 'string'
        ? meta['replacesSubscriptionId']
        : null;
    if (!replacesSubscriptionId) {
        return;
    }

    const cancelRes = await paypalCtr.cancelSubscription(context, {
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

async function recordStatusPollSubscriptionPayment(args: {
    context: I_Context;
    subscription: Record<string, any>;
    effectKey: string;
    order: Record<string, any>;
    paymentRequest: Record<string, any>;
}) {
    const lastPayment = getPayPalSubscriptionLastPayment(args.subscription);
    await paymentCtr.recordGatewayTransaction(args.context, {
        provider: E_PaymentProvider.PAYPAL,
        operation: E_PaymentGatewayOperation.SALE,
        transactionId: args.effectKey,
        userId: args.order['userId'] as string | undefined,
        orderId: args.order['id'] as string | undefined,
        paymentRequestId: args.paymentRequest['id'] as string | undefined,
        subscriptionId: args.subscription['id'] as string | undefined,
        amount: typeof lastPayment.amount === 'string' ? Number.parseFloat(lastPayment.amount) : lastPayment.amount ?? undefined,
        currency: lastPayment.currency ?? undefined,
        status: E_PaymentTransactionStatus.SUCCESS,
        success: true,
        source: E_PaymentTransactionSource.STATUS_POLL,
        responsePayload: args.subscription,
        occurredAt: lastPayment.time ? new Date(lastPayment.time) : new Date(),
        performedAt: new Date(),
    });
}

mainRouter.get('/payment/paypal/status', async (req, res, next) => {
    try {
        const paypalOrderId = resolvePayPalOrderId(req);
        // Log orderId when receiving PayPal status check request
        log.info('[PayPal][Status] Checking status with orderId:', { paypalOrderId });

        if (!paypalOrderId) {
            res.status(400).json({ success: false, message: 'paypalOrderId is required' });
            return;
        }

        const context: I_Context = { req };

        let paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
            filter: { externalOrderId: paypalOrderId, gateway: E_PaymentProvider.PAYPAL },
        });

        // Fallback: If not found by externalOrderId, try direct lookups using findOne
        // NOTE: We use getPaymentRequest (findOne) instead of getPaymentRequests (paginate)
        // because mongoose-paginate-v2 returns empty results for status $in queries.
        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            log.info('[PayPal Status] Payment request not found by externalOrderId, trying fallback lookups...', { paypalOrderId });

            // Try 1: Look up by ba_token in paymentUrl (subscriptions store the ba_token in paymentUrl)
            const baToken = (req.query?.['ba_token'] as string) || null;
            if (baToken) {
                const baTokenPR = await paymentRequestCtr.getPaymentRequest(context, {
                    filter: {
                        gateway: E_PaymentProvider.PAYPAL,
                        paymentUrl: { $regex: baToken },
                    } as any,
                });
                if (baTokenPR.success && baTokenPR.result) {
                    log.info('[PayPal Status] ba_token fallback found match:', {
                        id: baTokenPR.result.id,
                        externalOrderId: baTokenPR.result.externalOrderId,
                        status: baTokenPR.result.status,
                    });
                    paymentRequestRes = baTokenPR;
                }
            }
        }

        // Try 2: User-basis fallback - find the most recent PayPal PaymentRequest for this user
        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            const currentUser = await authnCtr.getUserFromSession(context);
            if (currentUser) {
                const userPR = await paymentRequestCtr.getPaymentRequest(context, {
                    filter: {
                        'gateway': E_PaymentProvider.PAYPAL,
                        'meta.userId': currentUser.id,
                    } as any,
                    options: { sort: { createdAt: -1 } },
                });

                if (userPR.success && userPR.result) {
                    log.info('[PayPal Status] User-basis fallback found match:', {
                        id: userPR.result.id,
                        externalOrderId: userPR.result.externalOrderId,
                        status: userPR.result.status,
                        userId: currentUser.id,
                    });
                    paymentRequestRes = userPR;
                }
                else {
                    log.warn('[PayPal Status] User-basis fallback found no results for user:', { userId: currentUser.id });
                }
            }
            else {
                log.warn('[PayPal Status] Cannot perform user-basis fallback - user not authenticated');
            }
        }

        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            log.warn('[PayPal Status] Payment request not found, initiating Dynamic Recovery check...', { paypalOrderId });

            // DYNAMIC RECOVERY: Ask PayPal directly what this ID is
            let recoveredGatewayResponse: any = null;
            let recoveredStatus: 'SUCCESS' | 'PENDING' | 'FAILED' = 'PENDING';
            let recoveredOrderType: E_OrderType = E_OrderType.A_LA_CARTE_EVENT;
            let recoveredExternalId: string = paypalOrderId;
            let recoveredEffectKey: string | null = null;

            // Run Subscription and Order checks based on ID format to avoid 400 errors from PayPal
            const isSubscriptionId = paypalOrderId.startsWith('I-');
            const [subCheck, orderCheck] = await Promise.allSettled([
                isSubscriptionId
                    ? paypalCtr.getSubscription(context, { subscriptionId: paypalOrderId })
                    : Promise.resolve({ success: false, message: 'Skipped: Not a subscription ID format' } as any),
                !isSubscriptionId
                    ? paypalCtr.getOrder(context, { orderId: paypalOrderId })
                    : Promise.resolve({ success: false, message: 'Skipped: Not a one-time order ID format' } as any),
            ]);

            // Evaluate Subscription Result
            if (subCheck.status === 'fulfilled' && subCheck.value.success && subCheck.value.result) {
                const sub = subCheck.value.result as any;
                if (sub.status === 'ACTIVE') {
                    const lastPayment = getPayPalSubscriptionLastPayment(sub);
                    recoveredEffectKey = buildPayPalSubscriptionPaymentEffectKey({
                        subscriptionId: sub.id,
                        occurredAt: lastPayment.time,
                        amount: lastPayment.amount,
                        currency: lastPayment.currency,
                    });
                    if (recoveredEffectKey) {
                        recoveredStatus = 'SUCCESS';
                        recoveredGatewayResponse = sub;
                        recoveredOrderType = E_OrderType.SUBSCRIPTION;
                        recoveredExternalId = sub.id;
                    }
                    else {
                        log.warn('[PayPal Status] Subscription ACTIVE but no last payment found; waiting for payment confirmation', {
                            subscriptionId: sub.id,
                        });
                    }
                }
            }

            // Evaluate Order Result if Subscription didn't win
            if (recoveredStatus !== 'SUCCESS' && orderCheck.status === 'fulfilled' && orderCheck.value.success && orderCheck.value.result) {
                const po = orderCheck.value.result as any;
                if (po.status === 'COMPLETED') {
                    recoveredStatus = 'SUCCESS';
                    recoveredGatewayResponse = po;
                    recoveredOrderType = E_OrderType.A_LA_CARTE_EVENT;
                    recoveredExternalId = po.id;
                }
            }

            if (recoveredStatus === 'SUCCESS') {
                log.info('[PayPal Status] Dynamic Recovery SUCCESS! Creating missing records...', { recoveredExternalId });
                const currentUser = await authnCtr.getUserFromSession(context);
                if (!currentUser) {
                    res.status(404).json({ success: false, message: 'Payment confirmed but user session lost. Please log in.' });
                    return;
                }

                // Create Order
                const newOrder = await orderCtr.createOrder(context, {
                    doc: {
                        userId: currentUser.id,
                        status: E_OrderStatus.PAID,
                        orderType: recoveredOrderType,
                        amount: 0,
                        meta: { externalOrderId: recoveredExternalId },
                    },
                });

                if (newOrder.success && newOrder.result) {
                    // Create Payment Request
                    const recoveredPaymentRequest = await paymentRequestCtr.createPaymentRequest(context, {
                        doc: {
                            gateway: E_PaymentProvider.PAYPAL,
                            status: E_PaymentRequestStatus.PAID,
                            externalOrderId: recoveredExternalId,
                            gatewayResponse: recoveredGatewayResponse,
                            meta: { userId: currentUser.id, orderId: newOrder.result.id },
                        },
                    });

                    if (recoveredOrderType === E_OrderType.SUBSCRIPTION && recoveredPaymentRequest.success && recoveredPaymentRequest.result) {
                        await paymentSubscriptionCtr.upsertFromProviderSnapshot(context, {
                            provider: E_PaymentProvider.PAYPAL,
                            providerSubscriptionId: recoveredExternalId,
                            userId: currentUser.id,
                            paymentRequestId: recoveredPaymentRequest.result.id,
                            orderId: newOrder.result.id,
                            source: E_PaymentSubscriptionSource.STATUS_POLL,
                            providerSnapshot: recoveredGatewayResponse,
                        });
                        if (recoveredEffectKey) {
                            await recordStatusPollSubscriptionPayment({
                                context,
                                subscription: recoveredGatewayResponse,
                                effectKey: recoveredEffectKey,
                                order: newOrder.result as any,
                                paymentRequest: recoveredPaymentRequest.result as any,
                            });
                        }
                    }

                    // Trigger effects
                    const fullOrder = await orderCtr.getOrder(context, {
                        filter: { id: newOrder.result.id },
                        populate: [{ path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] }],
                    });
                    if (fullOrder.success && fullOrder.result) {
                        const periodWindow = recoveredOrderType === E_OrderType.SUBSCRIPTION
                            ? resolvePaymentSubscriptionPeriodWindow(recoveredGatewayResponse)
                            : null;
                        await applyOrderPaidEffects(context, fullOrder.result, {
                            effectKey: recoveredEffectKey,
                            membershipPeriodStartAt: getPayPalSubscriptionLastPayment(recoveredGatewayResponse).time,
                            membershipPeriodEndAt: periodWindow?.billingPeriodEndAt,
                            membershipAccessUntilAt: periodWindow?.accessUntilAt,
                            source: E_MembershipEntitlementChangeSource.STATUS_POLL,
                            reason: E_MembershipEntitlementChangeReason.RENEWAL_PAYMENT,
                            paymentRequestId: recoveredPaymentRequest.success ? recoveredPaymentRequest.result?.id : undefined,
                            provider: E_PaymentProvider.PAYPAL,
                            providerSubscriptionId: recoveredOrderType === E_OrderType.SUBSCRIPTION ? recoveredExternalId : undefined,
                            transactionId: recoveredEffectKey,
                        });
                    }

                    // Re-run the lookup logic or just return manually
                    res.status(200).json({
                        success: true,
                        orderId: newOrder.result.id,
                        status: 'SUCCESS',
                        transactionId: recoveredExternalId,
                        registerStep: currentUser.registerStep, // might be updated now
                        isPaidMember: true,
                    });
                    return;
                }
            }

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

        const orderRes = await orderCtr.getOrder(context, {
            filter: { id: orderId },
            populate: [{ path: 'paymentTransaction' }],
        });

        if (!orderRes.success || !orderRes.result) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }

        const order = orderRes.result as any;
        const orderStatus = order.status;

        let status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCEL' = 'PENDING';
        if (orderStatus === E_OrderStatus.PAID) {
            status = 'SUCCESS';
        }
        else if (orderStatus === E_OrderStatus.FAILED) {
            status = 'FAILED';
        }
        else if (orderStatus === E_OrderStatus.CANCELLED) {
            status = 'CANCEL';
        }

        // Proactive Check: If order is still PENDING in our DB, verify status directly with PayPal
        if (status === 'PENDING') {
            const externalOrderId = paymentRequest.externalOrderId;
            if (externalOrderId) {
                log.info('[PayPal Status] Proactively checking PayPal API:', { externalOrderId });

                let resolvedStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'CANCEL' = 'PENDING';
                let gatewayResponse: any = null;
                let rawStatus = 'UNKNOWN';
                let effectKey: string | null = null;

                if (externalOrderId.startsWith('I-')) {
                    // Subscription Check
                    const subRes = await paypalCtr.getSubscription(context, { subscriptionId: externalOrderId });
                    if (subRes.success && subRes.result) {
                        gatewayResponse = subRes.result;
                        rawStatus = (subRes.result as any).status;
                        await paymentSubscriptionCtr.upsertFromProviderSnapshot(context, {
                            provider: E_PaymentProvider.PAYPAL,
                            providerSubscriptionId: externalOrderId,
                            userId: order.userId,
                            paymentRequestId: paymentRequest.id,
                            orderId: order.id,
                            pricingId: order.pricingId,
                            amount: typeof order.amount === 'number' ? order.amount : undefined,
                            replacesSubscriptionId: typeof meta?.['replacesSubscriptionId'] === 'string'
                                ? meta['replacesSubscriptionId']
                                : undefined,
                            replacementReason: meta?.['replacementReason'] === E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                                ? E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                                : undefined,
                            source: E_PaymentSubscriptionSource.STATUS_POLL,
                            providerSnapshot: gatewayResponse,
                            meta: meta ?? undefined,
                        });
                        const normalized = String(rawStatus || '').toUpperCase();
                        if (normalized === 'ACTIVE') {
                            const lastPayment = getPayPalSubscriptionLastPayment(subRes.result as any);
                            effectKey = buildPayPalSubscriptionPaymentEffectKey({
                                subscriptionId: externalOrderId,
                                occurredAt: lastPayment.time,
                                amount: lastPayment.amount,
                                currency: lastPayment.currency,
                            });
                            if (effectKey) {
                                resolvedStatus = 'SUCCESS';
                                await recordStatusPollSubscriptionPayment({
                                    context,
                                    subscription: subRes.result as any,
                                    effectKey,
                                    order,
                                    paymentRequest,
                                });
                            }
                            else {
                                resolvedStatus = 'PENDING';
                                log.warn('[PayPal Status] Subscription ACTIVE but no last payment found; not applying membership yet', {
                                    externalOrderId,
                                });
                            }
                        }
                        else if (['CANCELLED', 'SUSPENDED', 'EXPIRED'].includes(normalized)) {
                            resolvedStatus = 'CANCEL';
                        }
                        else if (['APPROVAL_PENDING', 'APPROVED', 'CREATED'].includes(normalized)) {
                            resolvedStatus = 'PENDING';
                        }
                        else {
                            resolvedStatus = 'FAILED';
                        }
                    }
                }
                else {
                    // One-time Order Check
                    const paypalOrderRes = await paypalCtr.getOrder(context, { orderId: externalOrderId });
                    if (paypalOrderRes.success && paypalOrderRes.result) {
                        gatewayResponse = paypalOrderRes.result;
                        rawStatus = (paypalOrderRes.result as any).status;
                        const normalized = String(rawStatus || '').toUpperCase();
                        if (normalized === 'COMPLETED') {
                            resolvedStatus = 'SUCCESS';
                        }
                        else if (['VOIDED', 'CANCELLED', 'DECLINED', 'FAILED', 'EXPIRED'].includes(normalized)) {
                            resolvedStatus = 'CANCEL';
                        }
                        else if (['APPROVED', 'CREATED', 'PAYER_ACTION_REQUIRED', 'SAVED', 'PENDING'].includes(normalized)) {
                            resolvedStatus = 'PENDING';
                        }
                        else {
                            resolvedStatus = 'FAILED';
                        }
                    }
                }

                log.info(`[PayPal Status] Proactive check result: ${rawStatus}`, { externalOrderId, resolvedStatus });

                if (resolvedStatus === 'SUCCESS') {
                    log.info('[PayPal Status] Confirmed PAID via API, syncing records...', { externalOrderId });
                    status = 'SUCCESS';

                    // Update records asynchronously
                    try {
                        await Promise.allSettled([
                            paymentRequestCtr.updatePaymentRequest(context, {
                                filter: { id: paymentRequest.id },
                                update: { $set: { status: E_PaymentRequestStatus.PAID, gatewayResponse } },
                            }),
                            orderCtr.updateOrder(context, {
                                filter: { id: order.id },
                                update: { $set: { status: E_OrderStatus.PAID } },
                            }),
                        ]);

                        // Apply effects immediately so user sees their new status
                        // Now safe (idempotent) to call for both one-time and subscription orders
                        const fullOrderRes = await orderCtr.getOrder(context, {
                            filter: { id: order.id },
                            populate: [
                                { path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] },
                            ],
                        });
                        if (fullOrderRes.success && fullOrderRes.result) {
                            const periodWindow = externalOrderId.startsWith('I-')
                                ? resolvePaymentSubscriptionPeriodWindow(gatewayResponse, meta)
                                : null;
                            await applyOrderPaidEffects(context, fullOrderRes.result, {
                                effectKey,
                                membershipPeriodStartAt: externalOrderId.startsWith('I-')
                                    ? getPayPalSubscriptionLastPayment(gatewayResponse).time
                                    : undefined,
                                membershipPeriodEndAt: periodWindow?.billingPeriodEndAt,
                                membershipAccessUntilAt: periodWindow?.accessUntilAt,
                                source: E_MembershipEntitlementChangeSource.STATUS_POLL,
                                reason: meta?.['replacementReason'] === E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                                    ? E_MembershipEntitlementChangeReason.TOP_UP_REPLACEMENT
                                    : E_MembershipEntitlementChangeReason.RENEWAL_PAYMENT,
                                paymentRequestId: paymentRequest.id,
                                provider: externalOrderId.startsWith('I-') ? E_PaymentProvider.PAYPAL : undefined,
                                providerSubscriptionId: externalOrderId.startsWith('I-') ? externalOrderId : undefined,
                                transactionId: effectKey,
                            });
                            if (externalOrderId.startsWith('I-')) {
                                await cancelReplacedSubscriptionAfterSuccess(context, meta, externalOrderId);
                            }
                            log.info('[PayPal Status] Applied order paid effects successfully');
                        }
                    }
                    catch (syncErr) {
                        log.error('[PayPal Status] Error syncing records after proactive confirm:', syncErr);
                    }
                }
                else if (resolvedStatus === 'CANCEL' || resolvedStatus === 'FAILED') {
                    status = resolvedStatus;

                    const orderStatusToSet = resolvedStatus === 'CANCEL'
                        ? E_OrderStatus.CANCELLED
                        : E_OrderStatus.FAILED;
                    const paymentRequestStatusToSet = resolvedStatus === 'CANCEL'
                        ? E_PaymentRequestStatus.CANCELLED
                        : E_PaymentRequestStatus.FAILED;
                    const shouldPreservePaidSubscriptionRequest = externalOrderId.startsWith('I-')
                        && paymentRequest.status === E_PaymentRequestStatus.PAID;

                    try {
                        await Promise.allSettled([
                            shouldPreservePaidSubscriptionRequest
                                ? Promise.resolve()
                                : paymentRequestCtr.updatePaymentRequest(context, {
                                        filter: { id: paymentRequest.id },
                                        update: { $set: { status: paymentRequestStatusToSet, gatewayResponse } },
                                    }),
                            shouldPreservePaidSubscriptionRequest
                                ? Promise.resolve()
                                : orderCtr.updateOrder(context, {
                                        filter: { id: order.id },
                                        update: { $set: { status: orderStatusToSet } },
                                    }),
                        ]);
                    }
                    catch (syncErr) {
                        log.error('[PayPal Status] Error syncing cancelled/failed status from PayPal:', syncErr);
                    }
                }
            }
        }
        // No else if needed here as status is already handled

        const transactionId = order?.paymentTransaction?.transactionId
            || order?.paymentTransactionId
            || null;

        const eventCreatedId = order?.meta && typeof order.meta === 'object'
            ? (order.meta as Record<string, unknown>)['eventCreatedId']
            : null;

        const latestUserRes = await userCtr.getUser(context, { filter: { id: order.userId } });
        const latestUser = latestUserRes.success ? latestUserRes.result : null;
        syncPaymentSessionUser(req, order.userId, latestUser as Record<string, any> | null);

        res.status(200).json({
            success: true,
            orderId: order.id,
            status,
            transactionId,
            eventCreated: Boolean(eventCreatedId),
            eventId: typeof eventCreatedId === 'string' ? eventCreatedId : null,
            registerStep: latestUser?.registerStep || null,
            isPaidMember: latestUser ? await authnCtr.isPaidMember({ req: { session: { user: latestUser } } } as any) : false,
            membershipExpiresAt: latestUser?.membershipExpiresAt || null,
        });
    }
    catch (error) {
        next(error);
    }
});

function resolvePayPalOrderId(req: Request): string | null {
    const body = req.body as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown> | undefined;

    const candidates: Array<unknown> = [
        // Prioritize subscription_id (I-...) which directly matches externalOrderId in DB
        body?.['subscription_id'],
        query?.['subscription_id'],
        body?.['orderId'],
        body?.['paypalOrderId'],
        query?.['orderId'],
        query?.['paypalOrderId'],
        // token/ba_token are ambiguous fallbacks - PayPal redirect tokens may not match stored values
        body?.['ba_token'],
        query?.['ba_token'],
        body?.['token'],
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

        // Ưu tiên tìm theo externalOrderId (PayPal), nếu không tìm thấy thì tìm theo id hệ thống (orderId nội bộ)
        let paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
            filter: { externalOrderId: paypalOrderId, gateway: E_PaymentProvider.PAYPAL },
        });

        // Nếu không tìm thấy theo externalOrderId, thử tìm theo id hệ thống
        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
                filter: { id: paypalOrderId, gateway: E_PaymentProvider.PAYPAL },
            });
        }

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

        // Nếu là subscriptionId (bắt đầu bằng I-) thì không gọi captureOrder, trả về lỗi rõ ràng
        if (paypalOrderId.startsWith('I-')) {
            res.status(400).json({
                success: false,
                message: 'PayPal capture không hỗ trợ subscriptionId. Chỉ dùng cho orderId.',
            });
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
                source: E_PaymentTransactionSource.STATUS_POLL,
                errorCode: paymentStatus === 'FAILED' ? 'PAYMENT_FAILED' : undefined,
                errorMessage: paymentStatus === 'FAILED' ? 'Payment failed' : undefined,
                responsePayload: (captureResult as Record<string, unknown>) ?? null,
                occurredAt: new Date(),
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

export function getPaymentRedirectBase() {
    const env = getEnv();
    const baseUrl = env.USER_APP_URL.replace(TRAILING_SLASHES_REGEX, '');
    return env.PAYMENT_REDIRECT_URL ?? `${baseUrl}/payment`;
}

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
            shipping_preference: E_PayPalShippingPreference.NO_SHIPPING,
            return_url: appendQueryParams(redirectBase, { status: 'SUCCESS', provider: E_PaymentProvider.PAYPAL, flow: 'subscription' }),
            cancel_url: appendQueryParams(redirectBase, { status: 'CANCEL', provider: E_PaymentProvider.PAYPAL, flow: 'subscription' }),
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

        // Record the payment request so it can be polled/tracked
        try {
            const externalOrderId = subscriptionRes.result.id;
            let token: string | undefined;
            if (approvalUrl) {
                try {
                    const url = new URL(approvalUrl);
                    token = url.searchParams.get('token') || url.searchParams.get('ba_token') || undefined;
                }
                catch { /* ignore */ }
            }

            // A) Create a formal Order record (required for polling logic)
            const orderDoc = {
                userId: currentUser.id,
                status: E_OrderStatus.PENDING,
                orderType: E_OrderType.SUBSCRIPTION,
                externalOrderId,
                amount: 0, // Will be updated by webhook on capture, or we could fetch plan price
                gateway: E_PaymentProvider.PAYPAL,
                meta: {
                    planId,
                    subscriptionId: externalOrderId,
                },
            };
            const orderRes = await orderCtr.createOrder(context, { doc: orderDoc });
            const createdOrder = orderRes.success ? orderRes.result : null;

            // B) Create the PaymentRequest
            const prDoc = {
                gateway: E_PaymentProvider.PAYPAL,
                status: E_PaymentRequestStatus.PENDING,
                externalOrderId,
                paymentUrl: approvalUrl,
                gatewayResponse: subscriptionRes.result as any,
                meta: {
                    userId: currentUser.id,
                    orderId: createdOrder?.id,
                    planId,
                    token,
                    pricingType: E_PricingType.MEMBERSHIP,
                },
            };
            await paymentRequestCtr.createPaymentRequest(context, { doc: prDoc });
            log.info(`[PayPal Subscription] Recorded order ${createdOrder?.id} and payment request for ${externalOrderId}`, { token });
        }
        catch (prError) {
            log.error('[PayPal Subscription] Failed to record payment records:', prError);
            // We don't fail the whole setup if only the tracking record fails, but it will break polling
        }

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
