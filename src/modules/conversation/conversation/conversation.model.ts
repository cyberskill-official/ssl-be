import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Conversation } from './conversation.type.js';

import { GROUP_RETENTION_DAYS } from './conversation.constant.js';
import { E_ConversationType } from './conversation.type.js';

export const ConversationModel = mongo.createModel<I_Conversation>({
    mongoose,
    name: 'Conversation',
    schema: {
        type: {
            type: String,
            enum: Object.values(E_ConversationType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the type for conversation',
                },
            ],
        },
        name: {
            type: String,
        },
        createdById: {
            type: String,
        },
        lastMessageId: {
            type: String,
        },
        entityId: {
            type: String,
        },
        retentionDays: {
            type: Number,
            default: GROUP_RETENTION_DAYS,
        },
        lastMessageAt: {
            type: Date,
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
            name: 'lastMessage',
            options: {
                ref: 'Message',
                localField: 'lastMessageId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'participants',
            options: {
                ref: 'Participant',
                localField: 'id',
                foreignField: 'conversationId',
                justOne: false,
            },
        },
    ],
});
