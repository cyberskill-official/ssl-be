import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_ModerationMediaStatus, E_ModerationMediaType } from '#modules/moderation/moderation-media/moderation-media.type.js';

import type { I_Gallery } from './gallery.type.js';

export const GalleryModel = mongo.createModel<I_Gallery>({
    mongoose,
    name: 'Gallery',
    schema: {
        moderationMediaId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please provide moderationMediaId',
                },
            ],
        },
        type: {
            type: String,
            enum: Object.values(E_ModerationMediaType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the gallery type',
                },
            ],
        },
        url: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter url for gallery',
                },
            ],
        },
        uploadedById: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the user who uploaded the gallery',
                },
            ],
        },
        status: {
            type: String,
            enum: Object.values(E_ModerationMediaStatus),
            default: E_ModerationMediaStatus?.PENDING,
        },
        isPublished: {
            type: Boolean,
            default: false,
        },
    },
    virtuals: [
        {
            name: 'moderationMedia',
            options: {
                ref: 'ModerationMedia',
                localField: 'moderationMediaId',
                foreignField: 'id',
                justOne: true,
            },
        },
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
            name: 'likes',
            options: {
                ref: 'Like',
                localField: 'id',
                foreignField: 'entityId',
                justOne: false,
            },
        },
        {
            name: 'views',
            options: {
                ref: 'View',
                localField: 'id',
                foreignField: 'entityId',
                justOne: false,
            },
        },
    ],
});
