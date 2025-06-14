import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_MessageStatus } from './message-status.type.js';

export const MessageStatusModel = mongo.createModel<I_MessageStatus>({
    mongoose,
    name: 'Message',
    pagination: true,
    schema: {
        messageId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter message id',
                },
            ],
        },
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter user id for message status',
                },
            ],
        },
        deliveredAt: {
            type: Date,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter deliver time for message',
                },
            ],
        },
        readAt: {
            type: Date,
        },
    },
    virtuals: [
        {
            name: 'message',
            options: {
                ref: 'Message',
                localField: 'messageId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
