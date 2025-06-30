import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PromoCodeUsage } from './promo-code-usage.type.js';

export const PromoCodeUsageModel = mongo.createModel<I_PromoCodeUsage>({
    mongoose,
    name: 'PromoCodeUsage',
    schema: {
        promoCodeId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'promoCodeId is required',
                },
            ],
        },
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'userId is required',
                },
            ],
        },
    },
    virtuals: [
        {
            name: 'promoCode',
            options: {
                ref: 'PromoCode',
                localField: 'promoCodeId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ]
});
