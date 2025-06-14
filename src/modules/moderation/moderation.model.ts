import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_ModerationStatus, E_ModerationType, type I_Moderation } from './moderation.type.js';

export const ModerationModel = mongo.createModel<I_Moderation>({
    mongoose,
    name: 'Moderation',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_ModerationType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the moderation type',
                },
            ],
        },
        uploadedById: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter uploaded by for moderation',
                },
            ],
        },
        url: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter url for moderation',
                },
            ],
        },
        status: {
            type: String,
            enum: Object.values(E_ModerationStatus),
            default: E_ModerationStatus.PENDING,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select status for moderation',
                },
            ],
        },
        moderatedById: {
            type: String,
        },
        reason: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'uploadedBy',
            options: {
                ref: 'User',
                localField: 'uploadedById',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
