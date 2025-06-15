import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_ModerationLog } from './moderation-log.type.js';

import { E_ModerationLogAction } from './moderation-log.type.js';

export const ModerationLogModel = mongo.createModel<I_ModerationLog>({
    mongoose,
    name: 'ModerationLog',
    pagination: true,
    schema: {
        action: {
            type: String,
            enum: Object.values(E_ModerationLogAction),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the moderation action',
                },
            ],
        },
        userId: {
            type: String,
        },
        moderationMediaId: {
            type: String,
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
            name: 'moderationMedia',
            options: {
                ref: 'ModerationMedia',
                localField: 'moderationMediaId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
