import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Pricing } from './pricing.type.js';

import { E_PricingType } from './pricing.type.js';

export const PricingModel = mongo.createModel<I_Pricing>({
    mongoose,
    name: 'Pricing',
    schema: {
        type: {
            type: String,
            enum: Object.values(E_PricingType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the pricing type',
                },
            ],
        },
        price: {
            type: Number,
            default: 0,
        },
        taxRate: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        countryId: {
            type: String,
        },
        stateId: {
            type: String,
        },
        currencyId: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'country',
            options: {
                ref: 'Country',
                localField: 'countryId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'state',
            options: {
                ref: 'State',
                localField: 'stateId',
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
