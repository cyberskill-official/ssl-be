import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_PricingType } from '#modules/pricing/pricing.type.js';

import type { I_Order } from './order.type.js';

import { E_OrderStatus } from './order.type.js';

export const OrderModel = mongo.createModel<I_Order>({
    mongoose,
    name: 'Order',
    pagination: true,
    schema: {
        userId: { type: String },
        amount: { type: Number },
        currencyId: { type: String },
        status: { type: String, enum: Object.values(E_OrderStatus) },
        externalGateway: { type: String },
        externalOrderId: { type: String },
        gatewayMidId: { type: String },
        clientOrderId: { type: String },
        customerDetails: { type: mongoose.Schema.Types.Mixed },
        meta: { type: mongoose.Schema.Types.Mixed, default: {} },
        pricingId: { type: String },
        pricingType: {
            type: String,
            enum: Object.values(E_PricingType),
        },
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
            name: 'currency',
            options: {
                ref: 'Currency',
                localField: 'currencyId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
