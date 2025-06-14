import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_PositionSlot, type I_Advertisement } from './advertisement.type.js';

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
        positionSlot: {
            type: String,
            enum: Object.values(E_PositionSlot),
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        clickCount: {
            type: Number,
            required: true,
            default: 0,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter click count number for advertisement',
                },
            ],
        },
        isActive: {
            type: Boolean,
            required: true,
            default: false,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please setup status for advertisement',
                },
            ],
        },
    },
});
