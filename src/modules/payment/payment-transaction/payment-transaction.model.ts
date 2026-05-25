import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentTransaction } from './payment-transaction.type.js';

import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentTransactionSource } from './payment-transaction.type.js';

export const PaymentTransactionModel = mongo.createModel<I_PaymentTransaction>({
    mongoose,
    name: 'PaymentTransaction',
    schema: {
        provider: {
            type: String,
            enum: Object.values(E_PaymentProvider),
            required: true,
        },
        operation: {
            type: String,
            enum: Object.values(E_PaymentGatewayOperation),
            required: true,
        },
        transactionId: {
            type: String,
            index: true,
        },
        providerEventId: {
            type: String,
            index: true,
        },
        userId: {
            type: String,
            index: true,
        },
        orderId: {
            type: String,
            index: true,
        },
        paymentRequestId: {
            type: String,
            index: true,
        },
        subscriptionId: {
            type: String,
            index: true,
        },
        amount: {
            type: Number,
        },
        currency: {
            type: String,
        },
        status: {
            type: String,
        },
        success: {
            type: Boolean,
            required: true,
        },
        source: {
            type: String,
            enum: Object.values(E_PaymentTransactionSource),
        },
        errorCode: {
            type: String,
        },
        errorMessage: {
            type: String,
        },
        responsePayload: {
            type: mongoose.Schema.Types.Mixed,
        },
        occurredAt: {
            type: Date,
            index: true,
        },
        performedAt: {
            type: Date,
            default: () => new Date(),
            index: true,
        },
    },
});

void PaymentTransactionModel.collection.createIndex(
    { provider: 1, operation: 1, transactionId: 1 },
    { name: 'idx_payment_transaction_dedupe' },
).catch(() => undefined);

void PaymentTransactionModel.collection.createIndex(
    { userId: 1, occurredAt: -1 },
    { name: 'idx_payment_transaction_user_occurred_at', sparse: true },
).catch(() => undefined);

void PaymentTransactionModel.collection.createIndex(
    { subscriptionId: 1, occurredAt: -1 },
    { name: 'idx_payment_transaction_subscription_occurred_at', sparse: true },
).catch(() => undefined);
