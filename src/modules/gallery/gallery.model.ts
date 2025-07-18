import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_ModerationMediaStatus, E_ModerationMediaType } from '#modules/moderation/index.js';

import type { I_Gallery, I_GalleryView } from './gallery.type.js';

export const GalleryViewSchema = mongo.createSchema<I_GalleryView>({
    standalone: true,
    mongoose,
    schema: {
        viewById: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please provide the user ID who viewed the gallery',
                },
            ],
        },
        viewCount: {
            type: Number,
            default: 0,
        },
    },
    virtuals: [
        {
            name: 'viewBy',
            options: {
                ref: 'User',
                localField: 'viewById',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

export const GalleryModel = mongo.createModel<I_Gallery>({
    mongoose,
    name: 'Gallery',
    pagination: true,
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
        likedByIds: {
            type: [String],
            default: [],
        },
        views: {
            type: [GalleryViewSchema],
            default: [],
        },
        status: {
            type: String,
            enum: Object.values(E_ModerationMediaStatus),
            default: E_ModerationMediaStatus.PENDING,
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
            name: 'likedBy',
            options: {
                ref: 'User',
                localField: 'likedByIds',
                foreignField: 'id',
                justOne: false,
            },
        },
    ],
});
