import type { I_PaymentSubscription } from '#modules/payment/payment-subscription/payment-subscription.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { orderCtr } from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import {
    E_MembershipEntitlementChangeReason,
    E_MembershipEntitlementChangeSource,
} from '#modules/payment/membership-entitlement-change/membership-entitlement-change.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/payment-request.controller.js';
import {
    E_PaymentRequestStatus,
} from '#modules/payment/payment-request/payment-request.type.js';
import { paymentSubscriptionCtr, resolvePaymentSubscriptionPeriodWindow } from '#modules/payment/payment-subscription/payment-subscription.controller.js';
import {
    E_PaymentSubscriptionReplacementReason,
    E_PaymentSubscriptionSource,
} from '#modules/payment/payment-subscription/payment-subscription.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/payment-transaction.controller.js';
import {
    E_PaymentGatewayOperation,
    E_PaymentProvider,
    E_PaymentTransactionSource,
    E_PaymentStatus as E_PaymentTransactionStatus,
} from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { paypalCtr } from '#modules/payment/paypal/paypal.controller.js';
import { buildPayPalSubscriptionPaymentEffectKey, getPayPalSubscriptionLastPayment } from '#modules/payment/paypal/paypal.effect-key.js';
import { getEnv } from '#shared/env/index.js';

import type { I_CronTaskContext } from '../cron.type.js';

import { runWithConcurrency } from '../cron.util.js';
import { downgradeUserToFree, extendActivePayPalRenewalDelayHold } from './membership.helper.js';

const env = getEnv();
const context = {} as I_Context;

interface I_ReconciliationSummary {
    due: number;
    processed: number;
    paymentsApplied: number;
    actionRequired: number;
    downgraded: number;
    replacedCancelled: number;
    failed: number;
}

function getProviderStatus(snapshot: Record<string, unknown>): string {
    const status = snapshot['status'];
    return typeof status === 'string' ? status.toUpperCase() : '';
}

function getFailedPaymentsCount(snapshot: Record<string, unknown>): number {
    const billingInfo = snapshot['billing_info'];
    const failedPaymentsRaw = billingInfo && typeof billingInfo === 'object'
        ? Number((billingInfo as Record<string, unknown>)['failed_payments_count'] ?? 0)
        : 0;
    return Number.isFinite(failedPaymentsRaw) ? failedPaymentsRaw : 0;
}

function increment(summary: I_ReconciliationSummary, key: keyof I_ReconciliationSummary): void {
    summary[key] += 1;
}

async function reconcileSubscription(
    localSubscription: I_PaymentSubscription,
    summary: I_ReconciliationSummary,
    cronContext: I_CronTaskContext,
): Promise<void> {
    const subscriptionId = localSubscription.providerSubscriptionId;

    try {
        const subRes = await paypalCtr.getSubscription(context, { subscriptionId });
        if (!subRes.success || !subRes.result) {
            await paymentSubscriptionCtr.markActionRequired(
                subscriptionId,
                subRes.message ?? 'Failed to fetch PayPal subscription during reconciliation',
            );
            increment(summary, 'actionRequired');
            return;
        }

        const paypalSubscription = subRes.result as unknown as Record<string, unknown>;
        const periodWindow = resolvePaymentSubscriptionPeriodWindow(
            paypalSubscription,
            localSubscription.meta,
        );
        const providerStatus = getProviderStatus(paypalSubscription);
        const lastPayment = getPayPalSubscriptionLastPayment(paypalSubscription);
        const effectKey = buildPayPalSubscriptionPaymentEffectKey({
            subscriptionId,
            occurredAt: lastPayment.time,
            amount: lastPayment.amount,
            currency: lastPayment.currency,
        });
        const previousLastPaidAt = localSubscription.lastPaidAt
            ? new Date(localSubscription.lastPaidAt)
            : null;
        const lastPaidAt = lastPayment.time ? new Date(lastPayment.time) : null;
        const hasNewPayment = Boolean(
            effectKey
            && lastPaidAt
            && (!previousLastPaidAt || lastPaidAt > previousLastPaidAt),
        );

        const subscriptionUpsertRes = await paymentSubscriptionCtr.upsertFromProviderSnapshot(context, {
            provider: E_PaymentProvider.PAYPAL,
            providerSubscriptionId: subscriptionId,
            userId: localSubscription.userId,
            paymentRequestId: localSubscription.paymentRequestId,
            orderId: localSubscription.orderId,
            pricingId: localSubscription.pricingId,
            amount: localSubscription.amount,
            currency: localSubscription.currency,
            replacesSubscriptionId: localSubscription.replacesSubscriptionId,
            replacementReason: localSubscription.replacementReason,
            source: E_PaymentSubscriptionSource.RECONCILIATION,
            meta: localSubscription.meta,
            providerSnapshot: paypalSubscription,
        });
        const refreshedSubscription = subscriptionUpsertRes.success && subscriptionUpsertRes.result
            ? subscriptionUpsertRes.result
            : localSubscription;

        if (hasNewPayment && localSubscription.orderId) {
            const [orderRes, paymentRequestRes] = await Promise.all([
                orderCtr.getOrder(context, { filter: { id: localSubscription.orderId } }),
                localSubscription.paymentRequestId
                    ? paymentRequestCtr.getPaymentRequest(context, { filter: { id: localSubscription.paymentRequestId } })
                    : Promise.resolve(null),
            ]);

            if (paymentRequestRes?.success && paymentRequestRes.result) {
                await paymentRequestCtr.updatePaymentRequest(context, {
                    filter: { id: paymentRequestRes.result.id },
                    update: { $set: { status: E_PaymentRequestStatus.PAID, gatewayResponse: paypalSubscription } },
                });
            }

            if (orderRes.success && orderRes.result) {
                await orderCtr.updateOrder(context, {
                    filter: { id: orderRes.result.id },
                    update: { $set: { status: E_OrderStatus.PAID } },
                });

                await paymentCtr.recordGatewayTransaction(context, {
                    provider: E_PaymentProvider.PAYPAL,
                    operation: E_PaymentGatewayOperation.SALE,
                    transactionId: effectKey!,
                    userId: orderRes.result.userId,
                    orderId: orderRes.result.id,
                    paymentRequestId: localSubscription.paymentRequestId,
                    subscriptionId,
                    amount: typeof lastPayment.amount === 'string'
                        ? Number.parseFloat(lastPayment.amount)
                        : lastPayment.amount ?? undefined,
                    currency: lastPayment.currency ?? undefined,
                    status: E_PaymentTransactionStatus.SUCCESS,
                    success: true,
                    source: E_PaymentTransactionSource.RECONCILIATION,
                    responsePayload: paypalSubscription,
                    occurredAt: lastPaidAt ?? new Date(),
                    performedAt: new Date(),
                });

                const refreshedOrderRes = await orderCtr.getOrder(context, { filter: { id: orderRes.result.id } });
                if (refreshedOrderRes.success && refreshedOrderRes.result) {
                    await applyOrderPaidEffects(context, refreshedOrderRes.result, {
                        effectKey,
                        membershipPeriodStartAt: lastPayment.time,
                        membershipPeriodEndAt: periodWindow.billingPeriodEndAt,
                        membershipAccessUntilAt: periodWindow.accessUntilAt,
                        source: E_MembershipEntitlementChangeSource.RECONCILIATION,
                        reason: localSubscription.replacementReason === E_PaymentSubscriptionReplacementReason.TOP_UP_REPLACEMENT
                            ? E_MembershipEntitlementChangeReason.TOP_UP_REPLACEMENT
                            : E_MembershipEntitlementChangeReason.RENEWAL_PAYMENT,
                        paymentRequestId: localSubscription.paymentRequestId,
                        provider: E_PaymentProvider.PAYPAL,
                        providerSubscriptionId: subscriptionId,
                        transactionId: effectKey,
                    });
                }

                increment(summary, 'paymentsApplied');
            }
        }

        if (localSubscription.replacesSubscriptionId && providerStatus === 'ACTIVE') {
            const cancelRes = await paypalCtr.cancelSubscription(context, {
                subscriptionId: localSubscription.replacesSubscriptionId,
                reason: `Replaced by ${subscriptionId}`,
            });
            if (!cancelRes.success) {
                await paymentSubscriptionCtr.markActionRequired(
                    localSubscription.replacesSubscriptionId,
                    cancelRes.message ?? 'Failed to cancel replaced subscription during reconciliation',
                );
                increment(summary, 'actionRequired');
            }
            else {
                increment(summary, 'replacedCancelled');
            }
        }

        const periodEnd = refreshedSubscription.currentPeriodEndAt
            ? new Date(refreshedSubscription.currentPeriodEndAt)
            : null;
        const graceUntil = refreshedSubscription.graceUntil
            ? new Date(refreshedSubscription.graceUntil)
            : periodEnd;
        const graceExpired = graceUntil ? graceUntil <= new Date() : false;
        const terminalStatus = ['CANCELLED', 'EXPIRED'].includes(providerStatus);
        const shouldDowngradeSuspended = providerStatus === 'SUSPENDED' && graceExpired;
        const activeWithoutPaymentAfterGrace = providerStatus === 'ACTIVE' && graceExpired && !hasNewPayment;
        const failedPaymentsCount = getFailedPaymentsCount(paypalSubscription);

        if (activeWithoutPaymentAfterGrace) {
            const holdUntil = localSubscription.userId && failedPaymentsCount <= 0
                ? await extendActivePayPalRenewalDelayHold({
                        userId: localSubscription.userId,
                        providerSubscriptionId: subscriptionId,
                        orderId: localSubscription.orderId,
                        paymentRequestId: localSubscription.paymentRequestId,
                        billingPeriodEndAt: periodEnd,
                        graceUntil,
                        lastPaidAt,
                        lastPaymentEffectKey: effectKey,
                    })
                : null;

            await paymentSubscriptionCtr.markActionRequired(
                subscriptionId,
                failedPaymentsCount > 0
                    ? `PayPal subscription is ACTIVE but has ${failedPaymentsCount} failed payment attempt(s) after the grace window.`
                    : 'PayPal subscription is ACTIVE but no renewal payment was detected after the grace window; access hold is active while waiting for delayed PayPal renewal.',
            );
            increment(summary, 'actionRequired');
            await cronContext.logger.warn({
                event: 'subscription_active_without_payment',
                message: 'PayPal subscription active without new payment after grace window.',
                meta: {
                    subscriptionId,
                    userId: localSubscription.userId,
                    graceUntil: graceUntil?.toISOString(),
                    failedPaymentsCount,
                    accessHoldUntil: holdUntil?.toISOString(),
                },
            });
            return;
        }

        if (localSubscription.userId && graceExpired && (terminalStatus || shouldDowngradeSuspended)) {
            const downgraded = await downgradeUserToFree({
                userId: localSubscription.userId,
                providerSubscriptionId: subscriptionId,
                orderId: localSubscription.orderId,
                paymentRequestId: localSubscription.paymentRequestId,
                reason: terminalStatus
                    ? E_MembershipEntitlementChangeReason.CANCELLED_EXPIRED
                    : E_MembershipEntitlementChangeReason.DOWNGRADE_EXPIRED,
                metadata: {
                    providerStatus,
                    graceUntil: graceUntil?.toISOString(),
                    source: 'payment-subscription-reconciliation',
                    billingPeriodEndAt: periodEnd?.toISOString(),
                },
            });
            if (downgraded) {
                increment(summary, 'downgraded');
            }
        }
    }
    catch (error) {
        increment(summary, 'failed');
        await paymentSubscriptionCtr.markActionRequired(
            subscriptionId,
            error instanceof Error ? error.message : String(error),
        );
        await cronContext.logger.error({
            event: 'subscription_reconcile_failed',
            message: 'Error reconciling PayPal subscription.',
            meta: { subscriptionId, error },
        });
    }
}

export async function executePaymentSubscriptionReconciliationTask(
    cronContext: I_CronTaskContext,
): Promise<Record<string, unknown>> {
    const batchSize = Number.isFinite(env.SUBSCRIPTION_RECONCILE_BATCH_SIZE)
        ? Math.max(1, env.SUBSCRIPTION_RECONCILE_BATCH_SIZE)
        : 50;
    const concurrency = Number.isFinite(env.SUBSCRIPTION_RECONCILE_CONCURRENCY)
        ? Math.max(1, env.SUBSCRIPTION_RECONCILE_CONCURRENCY)
        : 3;

    const dueSubscriptions = await paymentSubscriptionCtr.getDueForReconciliation(batchSize);
    const summary: I_ReconciliationSummary = {
        due: dueSubscriptions.length,
        processed: 0,
        paymentsApplied: 0,
        actionRequired: 0,
        downgraded: 0,
        replacedCancelled: 0,
        failed: 0,
    };

    if (dueSubscriptions.length === 0) {
        await cronContext.logger.info({
            event: 'subscriptions_due_none',
            message: 'No PayPal subscriptions due for reconciliation.',
        });
        return { ...summary, concurrency };
    }

    await runWithConcurrency(dueSubscriptions, concurrency, async (subscription) => {
        await reconcileSubscription(subscription, summary, cronContext);
        increment(summary, 'processed');
    });

    await cronContext.logger.info({
        event: 'subscription_reconciliation_summary',
        message: 'PayPal subscription reconciliation completed.',
        result: { ...summary, concurrency },
    });

    return { ...summary, concurrency };
}

export async function paymentSubscriptionReconciliationTask(
    cronContext: I_CronTaskContext,
): Promise<Record<string, unknown>> {
    return executePaymentSubscriptionReconciliationTask(cronContext);
}
