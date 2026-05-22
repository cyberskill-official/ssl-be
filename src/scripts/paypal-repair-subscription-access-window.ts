import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';
import process from 'node:process';

import { resolvePaymentSubscriptionPeriodWindow } from '../modules/payment/payment-subscription/payment-subscription.controller.js';
import { PaymentSubscriptionModel } from '../modules/payment/payment-subscription/payment-subscription.model.js';
import { E_PaymentSubscriptionStatus } from '../modules/payment/payment-subscription/payment-subscription.type.js';
import { E_PaymentProvider } from '../modules/payment/payment-transaction/payment-transaction.type.js';
import { UserModel } from '../modules/user/user.model.js';
import { getEnv } from '../shared/env/index.js';

const ELIGIBLE_STATUSES = [
    E_PaymentSubscriptionStatus.ACTIVE,
    E_PaymentSubscriptionStatus.SCHEDULED,
    E_PaymentSubscriptionStatus.CANCELLED,
];

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

function sameTimestamp(left?: Date | null, right?: Date | null): boolean {
    if (!left || !right) {
        return false;
    }
    return left.getTime() === right.getTime();
}

function toIso(value?: Date | null): string | null {
    return value instanceof Date && !Number.isNaN(value.getTime())
        ? value.toISOString()
        : null;
}

async function run() {
    const env = getEnv();
    const apply = hasFlag('--apply');
    const now = new Date();
    const summary = {
        mode: apply ? 'apply' : 'dry-run',
        scanned: 0,
        repaired: 0,
        normalizedSubscriptions: 0,
        alreadyAligned: 0,
        skippedNoNormalizedWindow: 0,
        skippedExpiredGrace: 0,
        skippedMissingUser: 0,
        skippedFutureUserExpiry: 0,
        candidates: [] as Array<Record<string, unknown>>,
    };

    await mongoose.connect(env.MONGO_URI);

    try {
        const subscriptions = await PaymentSubscriptionModel.find({
            provider: E_PaymentProvider.PAYPAL,
            status: { $in: ELIGIBLE_STATUSES },
            userId: { $exists: true, $ne: null },
            nextBillingAt: { $type: 'date' },
            graceUntil: { $type: 'date' },
            isDel: { $ne: true },
        }).sort({ updatedAt: -1 }).lean().exec();

        summary.scanned = subscriptions.length;

        for (const subscription of subscriptions) {
            const existingCurrentPeriodEndAt = subscription.currentPeriodEndAt
                ? new Date(subscription.currentPeriodEndAt)
                : null;
            const existingNextBillingAt = subscription.nextBillingAt
                ? new Date(subscription.nextBillingAt)
                : null;
            const existingGraceUntil = subscription.graceUntil
                ? new Date(subscription.graceUntil)
                : null;
            const periodWindow = resolvePaymentSubscriptionPeriodWindow(
                subscription.providerSnapshot as Record<string, unknown> | null | undefined,
                subscription.meta as Record<string, unknown> | null | undefined,
            );
            const normalizedPeriodEndAt = periodWindow.billingPeriodEndAt
                ?? existingCurrentPeriodEndAt;
            const graceUntil = periodWindow.accessUntilAt
                ?? existingGraceUntil;
            const needsSubscriptionNormalization = Boolean(
                periodWindow.paypalNextBillingAdjusted
                && normalizedPeriodEndAt
                && graceUntil,
            ) && (
                !sameTimestamp(existingCurrentPeriodEndAt, normalizedPeriodEndAt)
                || !sameTimestamp(existingNextBillingAt, normalizedPeriodEndAt)
                || !sameTimestamp(existingGraceUntil, graceUntil)
            );

            if (!normalizedPeriodEndAt || !graceUntil) {
                summary.skippedNoNormalizedWindow += 1;
                summary.candidates.push({
                    action: 'skip-missing-normalized-window',
                    providerSubscriptionId: subscription.providerSubscriptionId,
                    userId: subscription.userId,
                    rawPayPalNextBillingAt: toIso(periodWindow.rawNextBillingAt),
                    expectedBillingPeriodEndAt: toIso(periodWindow.expectedPeriodEndAt),
                });
                continue;
            }

            if (graceUntil <= now) {
                summary.skippedExpiredGrace += 1;
                summary.candidates.push({
                    action: 'skip-expired-grace',
                    providerSubscriptionId: subscription.providerSubscriptionId,
                    userId: subscription.userId,
                    normalizedBillingPeriodEndAt: toIso(normalizedPeriodEndAt),
                    graceUntil: toIso(graceUntil),
                    paypalNextBillingAdjusted: periodWindow.paypalNextBillingAdjusted,
                });
                continue;
            }

            if (needsSubscriptionNormalization && apply) {
                await PaymentSubscriptionModel.updateOne(
                    { id: subscription.id },
                    {
                        $set: {
                            currentPeriodEndAt: normalizedPeriodEndAt,
                            nextBillingAt: normalizedPeriodEndAt,
                            graceUntil,
                            nextReconcileAt: graceUntil,
                            meta: {
                                ...(subscription.meta as Record<string, unknown> | undefined),
                                rawPayPalNextBillingAt: periodWindow.rawNextBillingAt?.toISOString(),
                                expectedBillingPeriodEndAt: periodWindow.expectedPeriodEndAt?.toISOString(),
                                normalizedBillingPeriodEndAt: normalizedPeriodEndAt.toISOString(),
                                paypalNextBillingAdjusted: periodWindow.paypalNextBillingAdjusted,
                            },
                        },
                    },
                ).exec();
            }
            if (needsSubscriptionNormalization) {
                summary.normalizedSubscriptions += 1;
            }

            const user = await UserModel.findOne({
                id: subscription.userId,
                isDel: { $ne: true },
            }).select('id username email membershipExpiresAt membershipCancelled rolesIds').lean().exec();

            if (!user) {
                summary.skippedMissingUser += 1;
                summary.candidates.push({
                    action: 'skip-missing-user',
                    providerSubscriptionId: subscription.providerSubscriptionId,
                    userId: subscription.userId,
                    graceUntil: toIso(graceUntil),
                });
                continue;
            }

            const currentExpiry = user.membershipExpiresAt
                ? new Date(user.membershipExpiresAt)
                : null;

            if (sameTimestamp(currentExpiry, graceUntil)) {
                summary.alreadyAligned += 1;
                continue;
            }

            if (currentExpiry && currentExpiry > graceUntil) {
                summary.skippedFutureUserExpiry += 1;
                summary.candidates.push({
                    action: 'skip-user-expiry-later-than-paypal-grace',
                    providerSubscriptionId: subscription.providerSubscriptionId,
                    userId: user.id,
                    username: user.username,
                    membershipExpiresAt: toIso(currentExpiry),
                    graceUntil: toIso(graceUntil),
                });
                continue;
            }

            summary.candidates.push({
                action: apply ? 'repair' : 'would-repair',
                providerSubscriptionId: subscription.providerSubscriptionId,
                userId: user.id,
                username: user.username,
                status: subscription.status,
                rawPayPalNextBillingAt: toIso(periodWindow.rawNextBillingAt),
                expectedBillingPeriodEndAt: toIso(periodWindow.expectedPeriodEndAt),
                paypalNextBillingAdjusted: periodWindow.paypalNextBillingAdjusted,
                nextBillingAt: toIso(subscription.nextBillingAt),
                membershipExpiresAt: toIso(currentExpiry),
                graceUntil: toIso(graceUntil),
            });

            if (apply) {
                await UserModel.updateOne(
                    { id: user.id },
                    { $set: { membershipExpiresAt: graceUntil } },
                ).exec();
            }
            summary.repaired += 1;
        }

        log.info('[PayPalRepairAccessWindow] Summary');
        console.log(JSON.stringify(summary, null, 2));
    }
    finally {
        await mongoose.disconnect();
    }
}

run().catch(async (error: unknown) => {
    log.error('[PayPalRepairAccessWindow] Failed', error);
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    process.exitCode = 1;
});
