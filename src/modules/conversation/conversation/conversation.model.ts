import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_ContactAdmin, I_Conversation } from './conversation.type.js';

import { GROUP_RETENTION_DAYS } from './conversation.constant.js';
import { E_ContactBillingMembershipType, E_ContactClubEventType, E_ContactContentModerationType, E_ContactGeneralFeedbackType, E_ContactLegalComplianceType, E_ContactTechnicalAccountType, E_ContactTopic, E_ConversationType, E_Device } from './conversation.type.js';

export const ConversationContactAdminSchema = mongo.createSchema<I_ContactAdmin>({
    standalone: true,
    mongoose,
    schema: {
        topic: {
            type: String,
            enum: Object.values(E_ContactTopic),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select topic',
                },
            ],
        },
        username: {
            type: String,
        },
        email: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter your email',
                },
            ],
        },
        requestType: {
            type: String,
            enum: [
                ...Object.values(E_ContactTechnicalAccountType),
                ...Object.values(E_ContactBillingMembershipType),
                ...Object.values(E_ContactContentModerationType),
                ...Object.values(E_ContactClubEventType),
                ...Object.values(E_ContactLegalComplianceType),
                ...Object.values(E_ContactGeneralFeedbackType),
            ],
        },
        device: {
            type: String,
            enum: Object.values(E_Device),
        },
        message: {
            type: String,
            required: true,
        },
        image: {
            type: String,
        },
        paymentDate: {
            type: Date,
        },
        transactionId: {
            type: String,
        },
        profileLink: {
            type: String,
        },
        companyName: {
            type: String,
        },
    },
});

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
        contactAdmin: {
            type: ConversationContactAdminSchema,
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
