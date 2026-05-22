import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';

import type { I_PaymentGatewayEvent } from './payment-gateway-event.type.js';

import { E_PaymentGatewayEventProcessingStatus, E_PaymentGatewayEventVerificationStatus } from './payment-gateway-event.type.js';

export const PaymentGatewayEventModel = mongo.createModel<I_PaymentGatewayEvent>({
    mongoose,
    name: 'PaymentGatewayEvent',
    pagination: true,
    schema: {
        provider: {
            type: String,
            enum: Object.values(E_PaymentProvider),
            required: true,
            index: true,
        },
        eventId: {
            type: String,
            required: true,
            index: true,
        },
        eventType: {
            type: String,
            index: true,
        },
        resourceId: { type: String, index: true },
        subscriptionId: { type: String, index: true },
        transactionId: { type: String, index: true },
        orderId: { type: String, index: true },
        paymentRequestId: { type: String, index: true },
        userId: { type: String, index: true },
        verificationStatus: {
            type: String,
            enum: Object.values(E_PaymentGatewayEventVerificationStatus),
            default: E_PaymentGatewayEventVerificationStatus.PENDING,
        },
        processingStatus: {
            type: String,
            enum: Object.values(E_PaymentGatewayEventProcessingStatus),
            default: E_PaymentGatewayEventProcessingStatus.RECEIVED,
            index: true,
        },
        receivedAt: {
            type: Date,
            default: () => new Date(),
            index: true,
        },
        processedAt: { type: Date },
        attemptCount: {
            type: Number,
            default: 1,
        },
        errorMessage: { type: String },
        headers: { type: mongoose.Schema.Types.Mixed },
        payload: { type: mongoose.Schema.Types.Mixed },
    },
});

void PaymentGatewayEventModel.collection.createIndex(
    { provider: 1, eventId: 1 },
    { name: 'uniq_payment_gateway_event_provider_event_id', unique: true },
).catch(() => undefined);

void PaymentGatewayEventModel.collection.createIndex(
    { provider: 1, eventType: 1, receivedAt: -1 },
    { name: 'idx_payment_gateway_event_type_received_at' },
).catch(() => undefined);
