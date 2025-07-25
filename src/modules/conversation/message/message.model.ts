import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Message } from './message.type.js';

export const MessageModel = mongo.createModel<I_Message>({
    mongoose,
    name: 'Message',
    schema: {
        senderId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter sender id for message',
                },
            ],
        },
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content for message',
                },
            ],
        },
        conversationId: {
            type: String,
        },
        parentId: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'sender',
            options: {
                ref: 'User',
                localField: 'senderId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'conversation',
            options: {
                ref: 'Conversation',
                localField: 'conversationId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'parent',
            options: {
                ref: 'Message',
                localField: 'parentId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
