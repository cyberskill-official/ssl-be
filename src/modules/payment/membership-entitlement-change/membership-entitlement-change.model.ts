import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_MembershipEntitlementChange } from './membership-entitlement-change.type.js';

import { E_PaymentProvider } from '../payment-transaction/payment-transaction.type.js';
import {
    E_MembershipEntitlementChangeReason,
    E_MembershipEntitlementChangeSource,
} from './membership-entitlement-change.type.js';

export const MembershipEntitlementChangeModel = mongo.createModel<I_MembershipEntitlementChange>({
    mongoose,
    name: 'MembershipEntitlementChange',
    schema: {
        userId: {
            type: String,
            required: true,
        },
        orderId: {
            type: String,
        },
        paymentRequestId: {
            type: String,
        },
        provider: {
            type: String,
            enum: Object.values(E_PaymentProvider),
        },
        providerSubscriptionId: {
            type: String,
        },
        transactionId: {
            type: String,
        },
        effectKey: {
            type: String,
        },
        source: {
            type: String,
            enum: Object.values(E_MembershipEntitlementChangeSource),
            required: true,
        },
        reason: {
            type: String,
            enum: Object.values(E_MembershipEntitlementChangeReason),
            required: true,
        },
        beforeMembershipExpiresAt: {
            type: Date,
        },
        afterMembershipExpiresAt: {
            type: Date,
        },
        beforeRolesIds: {
            type: [String],
            default: [],
        },
        afterRolesIds: {
            type: [String],
            default: [],
        },
        beforeMembershipCancelled: {
            type: Boolean,
        },
        afterMembershipCancelled: {
            type: Boolean,
        },
        changedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
        },
    },
});

MembershipEntitlementChangeModel.schema.index({ userId: 1, changedAt: -1 });
MembershipEntitlementChangeModel.schema.index({ providerSubscriptionId: 1, effectKey: 1 });
MembershipEntitlementChangeModel.schema.index({ orderId: 1 });
MembershipEntitlementChangeModel.schema.index({ paymentRequestId: 1 });
