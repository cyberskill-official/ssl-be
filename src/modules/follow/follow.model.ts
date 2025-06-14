import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Follow } from './follow.type.js';

export const FollowModel = mongo.createModel<I_Follow>({
    mongoose,
    name: 'Follow',
    pagination: true,
    schema: {
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter userId for follow',
                },
            ],
        },
        followId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter followId for follow',
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
            name: 'follow',
            options: {
                ref: 'User',
                localField: 'followId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
