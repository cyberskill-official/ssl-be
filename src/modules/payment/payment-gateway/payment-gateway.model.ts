import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentGateway } from './payment-gateway.type.js';

export const PaymentGatewayModel = mongo.createModel<I_PaymentGateway>({
    mongoose,
    name: 'PaymentGateway',
    pagination: true,
    schema: {
        name: { type: String, required: true },
        code: { type: String, required: true },
        fee: { type: Number },
        image: { type: String },
        status: { type: String },
    },
    virtuals: [],
});
