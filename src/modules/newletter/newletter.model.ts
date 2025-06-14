import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_SenderType, E_TargetAudience, type I_Newletter } from './newletter.type.js';

export const NewLetterModel = mongo.createModel<I_Newletter>({
    mongoose,
    name: 'Newletter',
    pagination: true,
    schema: {
        campaignName: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter campaign name for new letter.',
            },
        },
        emailSubject: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter email subject for new letter.',
            },
        },
        senderName: {
            type: String,
        },
        senderEmail: {
            type: String,
        },
        emailContent: {
            type: String,
        },
        targetAudience: {
            type: String,
            enum: Object.values(E_TargetAudience),
        },
        recipientIds: {
            type: [String],
        },
        senderType: {
            type: String,
            enum: Object.values(E_SenderType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select sender type',
                },
            ],
        },
        scheduleDate: {
            type: Date,
        },
        scheduleTime: {
            type: String,
        },
        sentDate: {
            type: Date,
        },
        recipientCount: {
            type: Number,
            default: 0,
        },
        openCount: {
            type: Number,
            default: 0,
        },
        clickCount: {
            type: Number,
            default: 0,
        },
    },
    virtuals: [
        {
            name: 'recipient',
            options: {
                ref: 'User',
                localField: 'recipientIds',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
