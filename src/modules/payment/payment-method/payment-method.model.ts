import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PaymentMethod } from './payment-method.type.js';

export const PaymentMethodModel = mongo.createModel<I_PaymentMethod>({
    mongoose,
    name: 'PaymentMethod',
    pagination: true,
    schema: {
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter userId.',
                },
            ],
        },
        providerId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter providerId.',
                },
            ],
        },
        brand: { type: String },
        last4: { type: String },
        expMonth: { type: Number },
        expYear: { type: Number },
        billingName: { type: String },
        billingCountry: { type: String },
        isDefault: {
            type: Boolean,
            default: false,
        },
    },
    virtuals: [
        {
            name: 'provider',
            options: {
                ref: 'Provider',
                localField: 'providerId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
