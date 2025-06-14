import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_GalleryStatus, E_GalleryType, type I_Gallery } from './gallery.type.js';

export const GalleryModel = mongo.createModel<I_Gallery>({
    mongoose,
    name: 'Gallery',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_GalleryType),
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
        likeCount: {
            type: Number,
            default: 0,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter like count value for gallery',
                },
            ],
        },
        viewCount: {
            type: Number,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter view count value for gallery',
                },
            ],
        },
        status: {
            type: String,
            enum: Object.values(E_GalleryStatus),
            default: E_GalleryStatus.PENDING,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the gallery status',
                },
            ],
        },
        isPublished: {
            type: Boolean,
            default: false,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select published for gallery',
                },
            ],
        },
    },
});
