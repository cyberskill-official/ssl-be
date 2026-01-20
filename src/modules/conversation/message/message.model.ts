import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_ModerationMediaStatus } from '#modules/moderation/moderation-media/moderation-media.type.js';

import type { I_ContactAdmin } from '../conversation/conversation.type.js';
import type { I_Message } from './message.type.js';

import { E_ContactBillingMembershipType, E_ContactClubEventType, E_ContactContentModerationType, E_ContactGeneralFeedbackType, E_ContactLegalComplianceType, E_ContactTechnicalAccountType, E_ContactTopic, E_Device } from '../conversation/conversation.type.js';
import { E_MessageType } from './message.type.js';

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
            contactAdmin: {
                type: ConversationContactAdminSchema,
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
        statusMedia: {
            type: String,
            enum: Object.values(E_ModerationMediaStatus),
        },
        moderationMediaId: {
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
