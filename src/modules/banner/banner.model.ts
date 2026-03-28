import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Banner } from './banner.type.js';

export const BannerModel = mongo.createModel<I_Banner>({
    mongoose,
    name: 'Banner',
    schema: {
        image: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select image for banner',
                },
            ],
        },
        targetURL: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter target URL for banner',
                },
            ],
        },
        blogId: {
            type: String,
        },
        destinationId: {
            type: String,
        },
        createdById: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter createdById for banner',
                },
            ],
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
            name: 'blog',
            options: {
                ref: 'Blog',
                localField: 'blogId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'destination',
            options: {
                ref: 'Destination',
                localField: 'destinationId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
