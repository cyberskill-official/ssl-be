import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_ModerationLog } from './moderation-log.type.js';

export const ModerationLogModel = mongo.createModel<I_ModerationLog>({
    mongoose,
    name: 'ModerationLog',
    pagination: true,
    schema: {
        triggeredById: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter trigger id for moderation log',
                },
            ],
        },
        action: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter action for moderation log',
                },
            ],
        },
        targetId: {
            type: String,
        },
        comment: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'triggeredBy',
            options: {
                ref: 'User',
                localField: 'triggeredById',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'target',
            options: {
                ref: 'User',
                localField: 'targetId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
