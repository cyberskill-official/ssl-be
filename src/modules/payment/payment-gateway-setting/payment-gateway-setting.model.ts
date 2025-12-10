import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentGatewaySetting } from './payment-gateway-setting.type.js';

export const PaymentGatewaySettingModel = mongo.createModel<I_PaymentGatewaySetting>({
    mongoose,
    name: 'PaymentGatewaySetting',
    pagination: true,
    schema: {
        paymentGatewayId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter paymentGatewayId.',
                },
            ],
        },
        name: {
            type: String,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter a name.',
                },
            ],
        },
        key: {
            type: String,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter a key.',
                },
            ],
        },
        value: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter value.',
                },
            ],
        },
    },
    virtuals: [
        {
            name: 'paymentMethod',
            options: {
                ref: 'PaymentGateway',
                localField: 'paymentGatewayId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

PaymentGatewaySettingModel.schema.index({ paymentGatewayId: 1, key: 1 }, { unique: true });
