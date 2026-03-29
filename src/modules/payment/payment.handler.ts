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

const mainRouter = Router();
const TRAILING_SLASHES_REGEX = /\/+$/;

mainRouter.post('/webhook/paypal', paypalWebhookHandler);

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

        // Declare allActivePRs in the outer scope for later use

        // Fallback: If not found by externalOrderId, try to find by searching in gatewayResponse or meta
        // This is common when Frontend polls using a "token" (from return URL) instead of Subscription ID/Order ID
        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            log.info('[PayPal Status] Payment request not found by externalOrderId, trying fallback search:', { paypalOrderId });
            const allActivePRs = await paymentRequestCtr.getPaymentRequests(context, {
                filter: {
                    gateway: E_PaymentProvider.PAYPAL,
                    status: { $in: [E_PaymentRequestStatus.WAITING, E_PaymentRequestStatus.PENDING] } as any,
                },
                options: { limit: 100, sort: { createdAt: -1 } },
            });

            if (allActivePRs.success && allActivePRs.result?.docs) {
                const foundPr = allActivePRs.result.docs.find((pr) => {
                    const meta = pr.meta as any;
                    const gr = pr.gatewayResponse as any;

                    // 1. Check explicitly stored token or orderId in meta
                    if (meta?.token === paypalOrderId || meta?.orderId === paypalOrderId || meta?.internalOrderId === paypalOrderId) {
                        return true;
                    }

                    // 2. Check externalOrderId (direct match or prefix mismatch)
                    if (pr.externalOrderId === paypalOrderId || pr.externalOrderId === `I-${paypalOrderId}`) {
                        return true;
                    }

                    // 3. Fallback search in gatewayResponse
                    if (gr) {
                        // Check if it's the main ID in gatewayResponse
                        if (gr.id === paypalOrderId || gr.id === `I-${paypalOrderId}`) {
                            return true;
                        }

                        // Check if the token exists in links
                        const links = gr.links as any[];
                        if (Array.isArray(links)) {
                            if (links.some(l => typeof l.href === 'string' && l.href.includes(paypalOrderId))) {
                                return true;
                            }
                        }
                    }

                    return false;
                });

                if (foundPr) {
                    log.info('[PayPal Status] Fallback search found match:', { id: foundPr.id, externalOrderId: foundPr.externalOrderId });
                    paymentRequestRes = { success: true, result: foundPr };
                }
                else {
                    log.warn('[PayPal Status] Fallback search found no matches in active requests, trying user-basis fallback...');

                    // NEW: User-basis fallback. If we know who is calling, look for their pending requests.
                    const currentUser = await authnCtr.getUserFromSession(context);
                    if (currentUser) {
                        const userActivePRs = await paymentRequestCtr.getPaymentRequests(context, {
                            filter: {
                                'gateway': E_PaymentProvider.PAYPAL,
                                'status': { $in: [E_PaymentRequestStatus.WAITING, E_PaymentRequestStatus.PENDING] } as any,
                                'meta.userId': currentUser.id,
                            },
                            options: { limit: 5, sort: { createdAt: -1 } },
                        });

                        if (userActivePRs.success && userActivePRs.result?.docs?.length) {
                            // If there's only one, or if we can match it somehow, use it.
                            // For now, if we found active ones for this user specifically, pick the most recent one.
                            const latestPr = userActivePRs.result.docs[0] as any;
                            log.info('[PayPal Status] User-basis fallback found match:', { id: latestPr.id, userId: currentUser.id });
                            paymentRequestRes = { success: true, result: latestPr };
                        }
                    }
                    else {
                        log.warn('[PayPal Status] Fallback search found no matches and user not authenticated');
                    }
                }
            }
        }

        if (!paymentRequestRes.success || !paymentRequestRes.result) {
            log.warn('[PayPal Status] Payment request not found, initiating Dynamic Recovery check...', { paypalOrderId });

            // DYNAMIC RECOVERY: Ask PayPal directly what this ID is
            let recoveredGatewayResponse: any = null;
            let recoveredStatus: 'SUCCESS' | 'PENDING' | 'FAILED' = 'PENDING';
            let recoveredOrderType: E_OrderType = E_OrderType.A_LA_CARTE_EVENT;
            let recoveredExternalId: string = paypalOrderId;

            // Run Subscription and Order checks in parallel for speed
            const [subCheck, orderCheck] = await Promise.allSettled([
                paypalCtr.getSubscription(context, { subscriptionId: paypalOrderId }),
                !paypalOrderId.startsWith('I-')
                    ? paypalCtr.getOrder(context, { orderId: paypalOrderId })
                    : Promise.resolve({ success: false, result: null } as any),
            ]);

            // Evaluate Subscription Result
            if (subCheck.status === 'fulfilled' && subCheck.value.success && subCheck.value.result) {
                const sub = subCheck.value.result as any;
                if (sub.status === 'ACTIVE') {
                    recoveredStatus = 'SUCCESS';
                    recoveredGatewayResponse = sub;
                    recoveredOrderType = E_OrderType.SUBSCRIPTION;
                    recoveredExternalId = sub.id;
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
                    await paymentRequestCtr.createPaymentRequest(context, {
                        doc: {
                            gateway: E_PaymentProvider.PAYPAL,
                            status: E_PaymentRequestStatus.PAID,
                            externalOrderId: recoveredExternalId,
                            gatewayResponse: recoveredGatewayResponse,
                            meta: { userId: currentUser.id, orderId: newOrder.result.id },
                        },
                    });

                    // Trigger effects
                    const fullOrder = await orderCtr.getOrder(context, {
                        filter: { id: newOrder.result.id },
                        populate: [{ path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] }],
                    });
                    if (fullOrder.success && fullOrder.result) {
                        await applyOrderPaidEffects(context, fullOrder.result);
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

            // Sync effects/session immediately if already PAID but session is stale
            // (e.g. Webhook finished in another process, but the current user session doesn't know)
            // Using applyOrderPaidEffects ensures roles, expiry, and session are all aligned.
            const fullOrderRes = await orderCtr.getOrder(context, {
                filter: { id: order.id },
                populate: [{ path: 'pricing', populate: [{ path: 'currency' }, { path: 'country' }] }],
            });
            if (fullOrderRes.success && fullOrderRes.result) {
                await applyOrderPaidEffects(context, fullOrderRes.result);
            }
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

                if (externalOrderId.startsWith('I-')) {
                    // Subscription Check
                    const subRes = await paypalCtr.getSubscription(context, { subscriptionId: externalOrderId });
                    if (subRes.success && subRes.result) {
                        gatewayResponse = subRes.result;
                        rawStatus = (subRes.result as any).status;
                        const normalized = String(rawStatus || '').toUpperCase();
                        if (normalized === 'ACTIVE') {
                            resolvedStatus = 'SUCCESS';
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
                            await applyOrderPaidEffects(context, fullOrderRes.result);
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

                    try {
                        await Promise.allSettled([
                            paymentRequestCtr.updatePaymentRequest(context, {
                                filter: { id: paymentRequest.id },
                                update: { $set: { status: paymentRequestStatusToSet, gatewayResponse } },
                            }),
                            orderCtr.updateOrder(context, {
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
        body?.['orderId'],
        body?.['paypalOrderId'],
        body?.['token'],
        body?.['ba_token'],
        body?.['subscription_id'],
        query?.['orderId'],
        query?.['paypalOrderId'],
        query?.['token'],
        query?.['ba_token'],
        query?.['subscription_id'],
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
