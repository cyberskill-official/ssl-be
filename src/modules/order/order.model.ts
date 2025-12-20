import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Order } from './order.type.js';

import { E_OrderStatus, E_OrderType } from './order.type.js';

export const OrderModel = mongo.createModel<I_Order>({
    mongoose,
    name: 'Order',
    pagination: true,
    schema: {
        userId: { type: String },
        amount: { type: Number },
        status: { type: String, enum: Object.values(E_OrderStatus) },
        orderType: { type: String, enum: Object.values(E_OrderType) },
        paymentTransactionId: { type: String },
        netvalveMidId: { type: String }, // NetValve Merchant ID used for this order (for rebill)
        customerDetails: { type: mongoose.Schema.Types.Mixed },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
        pricingId: { type: String },
    },
    virtuals: [
        {
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'pricing',
            options: {
                ref: 'Pricing',
                localField: 'pricingId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'paymentTransaction',
            options: {
                ref: 'PaymentTransaction',
                localField: 'paymentTransactionId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'paymentRequests',
            options: {
                ref: 'PaymentRequest',
                localField: 'id',
                foreignField: 'orderId',
                justOne: false,
            },
        },
    ],
});
