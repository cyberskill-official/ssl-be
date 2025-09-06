import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Message } from './message.type.js';

import { E_MessageType } from './message.type.js';

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
            type: {
                type: String,
                enum: Object.values(E_MessageType),
                required: true,
                validate: [
                    {
                        validator: mongo.validator.isRequired(),
                        message: 'Please enter type for message content',
                    },
                ],
            },
            value: {
                type: String,
                required: true,
                validate: [
                    {
                        validator: mongo.validator.isRequired(),
                        message: 'Please enter value for message content',
                    },
                ],
            },
        },
        recipientId: {
            type: String,
        },
        conversationId: {
            type: String,
        },
        parentId: {
            type: String,
        },
        deletedAt: {
            type: Date,
        },
        redacted: {
            type: Boolean,
            default: false,
        },
        expiresAt: {
            type: Date,
            index: { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $exists: true } } },
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
        {
            name: 'messageStatuses',
            options: {
                ref: 'MessageStatus',
                localField: 'id',
                foreignField: 'messageId',
                justOne: false,
            },
        },
    ],
});
