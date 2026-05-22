import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentRequest } from './payment-request.type.js';

export const PaymentRequestModel = mongo.createModel<I_PaymentRequest>({
    mongoose,
    name: 'PaymentRequest',
    pagination: true,
    schema: {
        gateway: { type: String },
        status: { type: String },
        paymentUrl: { type: String },
        externalOrderId: { type: String, index: true },
        gatewayResponse: { type: mongoose.Schema.Types.Mixed },
        attempts: { type: Number, default: 0 },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
});

void PaymentRequestModel.collection.createIndex(
    { gateway: 1, externalOrderId: 1 },
    { name: 'idx_payment_request_gateway_external_order', sparse: true },
).catch(() => undefined);

void PaymentRequestModel.collection.createIndex(
    { 'meta.orderId': 1 },
    { name: 'idx_payment_request_meta_order_id', sparse: true },
).catch(() => undefined);

void PaymentRequestModel.collection.createIndex(
    { 'meta.userId': 1 },
    { name: 'idx_payment_request_meta_user_id', sparse: true },
).catch(() => undefined);
