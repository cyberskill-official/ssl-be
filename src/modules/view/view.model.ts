import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_View } from './view.type.js';

import { E_ViewEntityType } from './view.type.js';

export const ViewModel = mongo.createModel<I_View>({
    mongoose,
    name: 'View',
    schema: {
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter userId for like',
                },
            ],
        },
        entityType: {
            type: String,
            required: true,
            enum: Object.values(E_ViewEntityType),
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter entityType for like',
                },
            ],
        },
        entityId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter entityId for like',
                },
            ],
        },
        viewCount: {
            type: Number,
            default: 0,
        },
        lastViewedAt: {
            type: Date,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please provide the last viewed date',
                },
            ],
        },
    },
    virtuals: [
        {
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'entity',
            options: {
                ref: doc => doc.entityType,
                localField: 'entityId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
