import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_PushChatMessage } from './push-chat.type.js';

import { E_PushChatAudience } from './push-chat.type.js';

export const PushChatMessageModel = mongo.createModel<I_PushChatMessage>({
    mongoose,
    name: 'PushChatMessage',
    schema: {
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter message content',
                },
            ],
        },
        targetAudience: {
            type: String,
            enum: Object.values(E_PushChatAudience),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select target audience',
                },
            ],
        },
        sentById: {
            type: String,
        },
        recipientCount: {
            type: Number,
            default: 0,
        },
    },
    virtuals: [
        {
            name: 'sentBy',
            options: {
                ref: 'User',
                localField: 'sentById',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
