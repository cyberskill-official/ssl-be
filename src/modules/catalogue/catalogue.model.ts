import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_ModerationMediaStatus, E_ModerationMediaType } from '#modules/moderation/index.js';

import type { I_Catalogue } from './catalogue.type.js';

export const CatalogueModel = mongo.createModel<I_Catalogue>({
    mongoose,
    name: 'Catalogue',
    schema: {
        type: {
            type: String,
            enum: Object.values(E_ModerationMediaType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select catalogue type',
                },
            ],
        },
        tagId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter tag id catalogue',
                },
            ],
        },
        url: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter url for catalogue',
                },
            ],
        },
        moderationMediaId: {
            type: String,
        },
        status: {
            type: String,
            enum: Object.values(E_ModerationMediaStatus),
            default: E_ModerationMediaStatus.PENDING,
        },
    },
    virtuals: [
        {
            name: 'tag',
            options: {
                ref: 'Tag',
                localField: 'tagId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'moderationMedia',
            options: {
                ref: 'ModerationMedia',
                localField: 'moderationMediaId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
