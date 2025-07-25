import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Like } from './like.type.js';

import { E_EntityType } from './like.type.js';

export const LikeModel = mongo.createModel<I_Like>({
    mongoose,
    name: 'Like',
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
            enum: Object.values(E_EntityType),
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
