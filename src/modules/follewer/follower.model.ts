import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Follower } from './follower.type.js';

export const FollowerModel = mongo.createModel<I_Follower>({
    mongoose,
    name: 'Follower',
    pagination: true,
    schema: {
        followerId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter follower id',
                },
            ],
        },
        followeeId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter followee id',
                },
            ],
        },
    },
    virtuals: [
        {
            name: 'follower',
            options: {
                ref: 'User',
                localField: 'followerId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'followee',
            options: {
                ref: 'User',
                localField: 'followeeId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
