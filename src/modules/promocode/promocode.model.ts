import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_Benefit, type I_PromoCode } from './promocode.type.js';

export const PromoCodeModel = mongo.createModel<I_PromoCode>({
    mongoose,
    name: 'PromoCode',
    pagination: true,
    schema: {
        code: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter code for promo code',
                },
                {
                    validator: mongo.validator.isUnique(['code']),
                    message: 'Code must be unique',
                },
            ],
        },
        benefit: {
            type: String,
            enum: Object.values(E_Benefit),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select benefit type for promo code',
                },
            ],
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        isLimit: {
            type: Boolean,
            default: false,
        },
        usageLimit: {
            type: Number,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Usage limit is required for promo code',
                },
            ],
        },
        usageCount: {
            type: Number,
            required: true,
            default: 0,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Usage count is required for promo code',
                },
            ],
        },
    },
});
