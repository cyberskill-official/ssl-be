import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { NoteSchema } from '#modules/note/index.js';

import type { I_ModerationMedia } from './moderation-media.type.js';

import { E_ModerationMediaStatus, E_ModerationMediaType } from './moderation-media.type.js';

export const ModerationMediaModel = mongo.createModel<I_ModerationMedia>({
    mongoose,
    name: 'ModerationMedia',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_ModerationMediaType),
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
            enum: Object.values(E_ModerationMediaStatus),
            default: E_ModerationMediaStatus.PENDING,
        },
        moderatedById: {
            type: String,
        },
        reason: {
            type: String,
        },
        notes: {
            type: NoteSchema,
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
        {
            name: 'moderatedBy',
            options: {
                ref: 'User',
                localField: 'moderatedById',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
