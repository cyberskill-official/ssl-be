import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_ModerationLog } from './moderation-log.type.js';

import { E_ModerationLogAction, E_ModerationLogType } from './moderation-log.type.js';

export const ModerationLogModel = mongo.createModel<I_ModerationLog>({
    mongoose,
    name: 'ModerationLog',
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
        type: {
            type: String,
            enum: Object.values(E_ModerationLogType),
        },
        userId: {
            type: String,
        },
        targetUserId: {
            type: String,
        },
        moderationMediaId: {
            type: String,
        },
        messageId: {
            type: String,
        },
        content: {
            type: String,
        },
        reason: {
            type: String,
        },
        aiResult: {
            type: JSON,
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
            name: 'targetUser',
            options: {
                ref: 'User',
                localField: 'targetUserId',
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
        {
            name: 'message',
            options: {
                ref: 'Message',
                localField: 'messageId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
