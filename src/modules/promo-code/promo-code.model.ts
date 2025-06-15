import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PromoCode } from './promo-code.type.js';

import { E_PromoCodeBenefit } from './promo-code.type.js';

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
            enum: Object.values(E_PromoCodeBenefit),
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
        },
        usageCount: {
            type: Number,
            default: 0,
        },
    },
});
