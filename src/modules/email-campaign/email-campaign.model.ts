import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_EmailCampaign } from './email-campaign.type.js';

import { E_UserGroup } from './email-campaign.type.js';

export const EmailCampaignModel = mongo.createModel<I_EmailCampaign>({
    mongoose,
    name: 'EmailCampaign',
    pagination: true,
    schema: {
        name: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter campaign name for email campaign.',
            },
        },
        subject: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter email subject for email campaign.',
            },
        },
        content: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter email content for email campaign.',
            },
        },
        senderName: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter sender name for email campaign.',
            },
        },
        senderEmail: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter sender email for email campaign.',
            },
        },
        target: {
            type: String,
            enum: Object.values(E_UserGroup),
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please select a target for the email campaign.',
            },
        },
        customRecipientsIds: {
            type: [String],
        },
        isScheduled: {
            type: Boolean,
            default: false,
        },
        scheduledDate: {
            type: Date,
        },
        scheduledTime: {
            type: String,
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
            name: 'customRecipients',
            options: {
                ref: 'User',
                localField: 'customRecipientsIds',
                foreignField: 'id',
                justOne: false,
            },
        },
    ],
});
