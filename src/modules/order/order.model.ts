import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Order } from './order.type.js';

export const OrderModel = mongo.createModel<I_Order>({
    mongoose,
    name: 'Order',
    pagination: true,
    schema: {
        userId: { type: String },
        amount: { type: Number },
        currency: { type: String },
        status: { type: String, default: 'CREATED', index: true },
        successUrl: { type: String },
        cancelUrl: { type: String },
        pendingUrl: { type: String },
        externalGateway: { type: String },
        externalOrderId: { type: String },
        gatewayMidId: { type: String },
        clientOrderId: { type: String, index: true },
        customerDetails: { type: mongoose.Schema.Types.Mixed },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    virtuals: [],
});
