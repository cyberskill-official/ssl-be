import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentRequest } from './payment-request.type.js';

export const PaymentRequestModel = mongo.createModel<I_PaymentRequest>({
    mongoose,
    name: 'PaymentRequest',
    pagination: true,
    schema: {
        orderId: { type: String },
        clientOrderId: { type: String, index: true },
        amount: { type: Number },
        currency: { type: String },
        gateway: { type: String },
        status: { type: String, default: 'WAITING', index: true },
        paymentUrl: { type: String },
        externalOrderId: { type: String },
        gatewayResponse: { type: mongoose.Schema.Types.Mixed },
        attempts: { type: Number, default: 0 },
        expiresAt: { type: Date, default: null, index: true },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    virtuals: [
        {
            name: 'order',
            options: {
                ref: 'Order',
                localField: 'orderId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
