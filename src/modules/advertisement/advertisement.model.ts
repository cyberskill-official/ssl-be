import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Advertisement } from './advertisement.type.js';

import { E_AdvertisementPlacementType, E_AdvertisementSlot } from './advertisement.type.js';

export const AdvertisementModel = mongo.createModel<I_Advertisement>({
    mongoose,
    name: 'Advertisement',
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
        description: {
            type: String,
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
        createdById: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter createdById for advertisement',
                },
            ],
        },
        slot: {
            type: String,
            enum: Object.values(E_AdvertisementSlot),
        },
        placementType: {
            type: String,
            enum: Object.values(E_AdvertisementPlacementType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select placement type for advertisement',
                },
            ],
        },
        placementId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select a page for advertisement',
                },
            ],
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
        isActive: {
            type: Boolean,
            default: false,
        },
    },
    virtuals: [
        {
            name: 'createdBy',
            options: {
                ref: 'User',
                localField: 'createdById',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'placementDestination',
            options: {
                ref: 'Destination',
                localField: 'placementId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'placementBlog',
            options: {
                ref: 'Blog',
                localField: 'placementId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

// Indexes for cron job performance
AdvertisementModel.schema.index({ isActive: 1, endDate: 1 }, { name: 'idx_advertisements_active_end_date' });
AdvertisementModel.schema.index({ isActive: 1, isDel: 1, startDate: 1, endDate: 1 }, { name: 'idx_advertisements_scheduled_activation' });
