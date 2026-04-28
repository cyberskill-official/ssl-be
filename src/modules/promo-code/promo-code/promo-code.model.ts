import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PromoCode } from './promo-code.type.js';

export const PromoCodeModel = mongo.createModel<I_PromoCode>({
    mongoose,
    name: 'PromoCode',
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
        expiresAt: {
            type: Date,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter expires at for promo code',
                },
            ],
        },
        grantDays: {
            type: Number,
            default: 30, // Default to 30 days of membership
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
        globalUsageLimit: {
            type: Number,
        },
    },
});
