import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Participant } from './participant.type.js';

import { E_ParticipantRole } from './participant.type.js';

export const ParticipantModel = mongo.createModel<I_Participant>({
    mongoose,
    name: 'Participant',
    schema: {
        conversationId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter conversation for participant',
                },
            ],
        },
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter userId for participant',
                },
            ],
        },
        lastReadMessageId: {
            type: String,
        },
        role: {
            type: String,
            enum: Object.values(E_ParticipantRole),
            default: E_ParticipantRole.MEMBER,
        },
    },
    virtuals: [
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
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'lastReadMessage',
            options: {
                ref: 'Message',
                localField: 'lastReadMessageId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

ParticipantModel.schema.index({ conversationId: 1 });
ParticipantModel.schema.index({ userId: 1, conversationId: 1 });
