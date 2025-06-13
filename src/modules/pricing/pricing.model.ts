import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Pricing } from './pricing.type.js';

import { E_PricingType } from './pricing.type.js';

export const PricingModel = mongo.createModel<I_Pricing>({
    mongoose,
    name: 'Pricing',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_PricingType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the pricing type.',
                },
            ],
        },
        countryId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter country for pricing.',
                },
            ],
        },
        price: {
            type: Number,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter value price.',
                },
            ],
        },
        taxRate: {
            type: Number,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter percent taxRate.',
                },
            ],
        },
        isActive: {
            type: Boolean,
            default: false,
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
    ],
});
