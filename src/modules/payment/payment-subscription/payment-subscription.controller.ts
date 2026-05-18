import type { I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { MongooseController } from '@cyberskill/shared/node/mongo';
import { addDays, addMinutes } from 'date-fns';

import type { I_Context } from '#shared/typescript/index.js';

import { getEnv } from '#shared/env/index.js';

import { E_PaymentProvider } from '../payment-transaction/payment-transaction.type.js';
import { PaymentSubscriptionModel } from './payment-subscription.model.js';
import {
    E_PaymentSubscriptionSource,
    E_PaymentSubscriptionStatus,
    type I_Input_QueryPaymentSubscription,
    type I_Input_UpsertPaymentSubscriptionSnapshot,
    type I_PaymentSubscription,
} from './payment-subscription.type.js';

const paymentSubscriptionMongooseCtr = new MongooseController<I_PaymentSubscription>(PaymentSubscriptionModel);
const env = getEnv();

const BILLABLE_STATUSES = [
    E_PaymentSubscriptionStatus.PENDING_APPROVAL,
    E_PaymentSubscriptionStatus.APPROVAL_PENDING,
    E_PaymentSubscriptionStatus.SCHEDULED,
    E_PaymentSubscriptionStatus.ACTIVE,
    E_PaymentSubscriptionStatus.PAST_DUE,
    E_PaymentSubscriptionStatus.SUSPENDED,
    E_PaymentSubscriptionStatus.ACTION_REQUIRED,
];

function toDate(value: unknown): Date | undefined {
    if (!value || typeof value !== 'string') {
        return undefined;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function getNestedDate(payload: Record<string, unknown> | undefined, path: string[]): Date | undefined {
    let current: unknown = payload;
    for (const key of path) {
        if (!current || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[key];
    }
    return toDate(current);
}

function getProviderStatus(payload?: Record<string, unknown>, fallback?: string): string | undefined {
    const status = typeof payload?.['status'] === 'string' ? payload['status'] : fallback;
    return status?.toUpperCase();
}

function resolveLocalStatus(args: {
    explicitStatus?: E_PaymentSubscriptionStatus;
    providerStatus?: string;
    startTime?: Date;
    lastPaidAt?: Date;
}): E_PaymentSubscriptionStatus {
    if (args.explicitStatus) {
        return args.explicitStatus;
    }

    switch (args.providerStatus) {
        case 'ACTIVE':
            if (!args.lastPaidAt && args.startTime && args.startTime > new Date()) {
                return E_PaymentSubscriptionStatus.SCHEDULED;
            }
            return E_PaymentSubscriptionStatus.ACTIVE;
        case 'APPROVAL_PENDING':
        case 'APPROVED':
            return E_PaymentSubscriptionStatus.APPROVAL_PENDING;
        case 'SUSPENDED':
            return E_PaymentSubscriptionStatus.SUSPENDED;
        case 'CANCELLED':
            return E_PaymentSubscriptionStatus.CANCELLED;
        case 'EXPIRED':
            return E_PaymentSubscriptionStatus.EXPIRED;
        default:
            return E_PaymentSubscriptionStatus.PENDING_APPROVAL;
    }
}

function getGraceMinutes(): number {
    return Number.isFinite(env.SUBSCRIPTION_RENEWAL_GRACE_MINUTES)
        ? Math.max(0, env.SUBSCRIPTION_RENEWAL_GRACE_MINUTES)
        : 30;
}

function resolveLocalOverridePeriodEnd(lastPaidAt?: Date): Date | undefined {
    if (!lastPaidAt) {
        return undefined;
    }

    if (env.MEMBERSHIP_EXTENSION_DAYS_OVERRIDE > 0) {
        return addDays(lastPaidAt, env.MEMBERSHIP_EXTENSION_DAYS_OVERRIDE);
    }

    if (env.MEMBERSHIP_EXTENSION_MINUTES_OVERRIDE > 0) {
        return addMinutes(lastPaidAt, env.MEMBERSHIP_EXTENSION_MINUTES_OVERRIDE);
    }

    return undefined;
}

function resolveNextReconcileAt(args: {
    status: E_PaymentSubscriptionStatus;
    nextBillingAt?: Date;
    currentPeriodEndAt?: Date;
    startTime?: Date;
    preferCurrentPeriodEnd?: boolean;
}): Date {
    const now = new Date();
    const graceMinutes = getGraceMinutes();
    if (args.currentPeriodEndAt && args.preferCurrentPeriodEnd) {
        return addMinutes(args.currentPeriodEndAt, graceMinutes);
    }
    if (args.currentPeriodEndAt && args.currentPeriodEndAt > now) {
        return addMinutes(args.currentPeriodEndAt, graceMinutes);
    }
    if (args.nextBillingAt) {
        return addMinutes(args.nextBillingAt, graceMinutes);
    }
    if (args.startTime && args.startTime > now) {
        return addMinutes(args.startTime, 5);
    }
    if ([
        E_PaymentSubscriptionStatus.CANCELLED,
        E_PaymentSubscriptionStatus.EXPIRED,
    ].includes(args.status)) {
        return addMinutes(now, 60);
    }
    return addMinutes(now, 5);
}

export const paymentSubscriptionCtr = {
    getPaymentSubscription(_context: I_Context, args: I_Input_FindOne<I_Input_QueryPaymentSubscription>) {
        return paymentSubscriptionMongooseCtr.findOne(args.filter as any, args.projection, args.options, args.populate);
    },

    getPaymentSubscriptions(_context: I_Context, args: I_Input_FindPaging<I_Input_QueryPaymentSubscription>) {
        return paymentSubscriptionMongooseCtr.findPaging((args.filter ?? {}) as any, args.options);
    },

    async upsertFromProviderSnapshot(
        _context: I_Context,
        { providerSnapshot, ...input }: I_Input_UpsertPaymentSubscriptionSnapshot,
    ): Promise<I_Return<I_PaymentSubscription>> {
        const providerStatus = getProviderStatus(providerSnapshot, input.providerStatus);
        const startTime = getNestedDate(providerSnapshot, ['start_time']);
        const lastPaidAt = getNestedDate(providerSnapshot, ['billing_info', 'last_payment', 'time']);
        const nextBillingAt = getNestedDate(providerSnapshot, ['billing_info', 'next_billing_time']);
        const currentPeriodStartAt = lastPaidAt ?? startTime;
        const localOverridePeriodEndAt = nextBillingAt ? undefined : resolveLocalOverridePeriodEnd(lastPaidAt);
        const currentPeriodEndAt = nextBillingAt ?? localOverridePeriodEndAt;
        const status = resolveLocalStatus({
            explicitStatus: input.status,
            providerStatus,
            startTime,
            lastPaidAt,
        });
        const graceUntil = currentPeriodEndAt
            ? addMinutes(currentPeriodEndAt, getGraceMinutes())
            : undefined;
        const nextReconcileAt = resolveNextReconcileAt({
            status,
            nextBillingAt,
            currentPeriodEndAt,
            startTime,
            preferCurrentPeriodEnd: Boolean(localOverridePeriodEndAt),
        });

        const update = {
            $set: {
                provider: input.provider,
                providerSubscriptionId: input.providerSubscriptionId,
                ...(input.userId && { userId: input.userId }),
                status,
                providerStatus,
                ...(currentPeriodStartAt && { currentPeriodStartAt }),
                ...(currentPeriodEndAt && { currentPeriodEndAt }),
                ...(nextBillingAt && { nextBillingAt }),
                ...(lastPaidAt && { lastPaidAt }),
                ...(input.paymentRequestId && { paymentRequestId: input.paymentRequestId }),
                ...(input.orderId && { orderId: input.orderId }),
                ...(input.pricingId && { pricingId: input.pricingId }),
                ...(typeof input.amount === 'number' && { amount: input.amount }),
                ...(input.currency && { currency: input.currency }),
                ...(input.replacesSubscriptionId && { replacesSubscriptionId: input.replacesSubscriptionId }),
                ...(input.replacedBySubscriptionId && { replacedBySubscriptionId: input.replacedBySubscriptionId }),
                ...(input.replacementReason && { replacementReason: input.replacementReason }),
                nextReconcileAt,
                ...(graceUntil && { graceUntil }),
                lastCheckedAt: new Date(),
                source: input.source ?? E_PaymentSubscriptionSource.CHECKOUT,
                ...(providerSnapshot && { providerSnapshot }),
                ...(input.meta && { meta: input.meta }),
            },
            $unset: {
                lastError: '',
            },
        };

        const doc = await PaymentSubscriptionModel.findOneAndUpdate(
            {
                provider: input.provider,
                providerSubscriptionId: input.providerSubscriptionId,
            },
            update,
            { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean().exec();

        if (!doc) {
            return {
                success: false,
                code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
                message: 'Failed to upsert payment subscription.',
            };
        }

        return {
            success: true,
            result: doc as I_PaymentSubscription,
        };
    },

    async findCurrentBillablePayPalSubscription(userId: string): Promise<I_PaymentSubscription | null> {
        const doc = await PaymentSubscriptionModel.findOne({
            provider: E_PaymentProvider.PAYPAL,
            userId,
            status: { $in: BILLABLE_STATUSES },
        }).sort({ createdAt: -1 }).lean().exec();

        return doc as I_PaymentSubscription | null;
    },

    async getDueForReconciliation(limit: number): Promise<I_PaymentSubscription[]> {
        const docs = await PaymentSubscriptionModel.find({
            provider: E_PaymentProvider.PAYPAL,
            status: { $in: BILLABLE_STATUSES },
            nextReconcileAt: { $lte: new Date() },
        }).sort({ nextReconcileAt: 1 }).limit(limit).lean().exec();

        return docs as I_PaymentSubscription[];
    },

    async markActionRequired(providerSubscriptionId: string, lastError: string): Promise<void> {
        await PaymentSubscriptionModel.updateOne(
            { provider: E_PaymentProvider.PAYPAL, providerSubscriptionId },
            {
                $set: {
                    status: E_PaymentSubscriptionStatus.ACTION_REQUIRED,
                    lastError,
                    lastCheckedAt: new Date(),
                    nextReconcileAt: addMinutes(new Date(), 5),
                },
            },
        ).exec();
    },

    async linkReplacement(oldProviderSubscriptionId: string, replacementProviderSubscriptionId: string): Promise<void> {
        await PaymentSubscriptionModel.updateOne(
            { provider: E_PaymentProvider.PAYPAL, providerSubscriptionId: oldProviderSubscriptionId },
            {
                $set: {
                    replacedBySubscriptionId: replacementProviderSubscriptionId,
                    nextReconcileAt: addMinutes(new Date(), 5),
                },
            },
        ).exec();
    },
};

export default paymentSubscriptionCtr;
