import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentSubscription } from './payment-subscription.type.js';

import { E_PaymentProvider } from '../payment-transaction/payment-transaction.type.js';
import {
    E_PaymentSubscriptionReplacementReason,
    E_PaymentSubscriptionSource,
    E_PaymentSubscriptionStatus,
} from './payment-subscription.type.js';

export const PaymentSubscriptionModel = mongo.createModel<I_PaymentSubscription>({
    mongoose,
    name: 'PaymentSubscription',
    schema: {
        provider: {
            type: String,
            enum: Object.values(E_PaymentProvider),
            required: true,
        },
        providerSubscriptionId: {
            type: String,
            required: true,
        },
        userId: {
            type: String,
        },
        status: {
            type: String,
            enum: Object.values(E_PaymentSubscriptionStatus),
            required: true,
            default: E_PaymentSubscriptionStatus.PENDING_APPROVAL,
        },
        providerStatus: {
            type: String,
        },
        currentPeriodStartAt: {
            type: Date,
        },
        currentPeriodEndAt: {
            type: Date,
        },
        nextBillingAt: {
            type: Date,
        },
        lastPaidAt: {
            type: Date,
        },
        paymentRequestId: {
            type: String,
        },
        orderId: {
            type: String,
        },
        pricingId: {
            type: String,
        },
        amount: {
            type: Number,
        },
        currency: {
            type: String,
        },
        replacesSubscriptionId: {
            type: String,
        },
        replacedBySubscriptionId: {
            type: String,
        },
        replacementReason: {
            type: String,
            enum: Object.values(E_PaymentSubscriptionReplacementReason),
        },
        nextReconcileAt: {
            type: Date,
        },
        graceUntil: {
            type: Date,
        },
        lastCheckedAt: {
            type: Date,
        },
        lastError: {
            type: String,
        },
        source: {
            type: String,
            enum: Object.values(E_PaymentSubscriptionSource),
        },
        providerSnapshot: {
            type: mongoose.Schema.Types.Mixed,
        },
        meta: {
            type: mongoose.Schema.Types.Mixed,
        },
    },
});

PaymentSubscriptionModel.schema.index({ provider: 1, providerSubscriptionId: 1 }, { unique: true });
PaymentSubscriptionModel.schema.index({ userId: 1, status: 1 });
PaymentSubscriptionModel.schema.index({ nextReconcileAt: 1, status: 1 });
PaymentSubscriptionModel.schema.index({ replacesSubscriptionId: 1 });
