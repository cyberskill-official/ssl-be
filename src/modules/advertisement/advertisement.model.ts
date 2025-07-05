import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Advertisement } from './advertisement.type.js';

import { E_AdvertisementSlot } from './advertisement.type.js';

export const AdvertisementModel = mongo.createModel<I_Advertisement>({
    mongoose,
    name: 'Advertisement',
    pagination: true,
    schema: {
        name: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter name for advertisement',
                },
            ],
        },
        image: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select image for advertisement',
                },
            ],
        },
        targetURL: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select target URL for advertisement',
                },
            ],
        },
        slot: {
            type: String,
            enum: Object.values(E_AdvertisementSlot),
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        clickCount: {
            type: Number,
            default: 0,
        },
        viewCount: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: false,
        },
    },
});
