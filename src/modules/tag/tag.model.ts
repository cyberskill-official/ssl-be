import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Tag } from './tag.type.js';

import { E_TagType } from './tag.type.js';

export const TagModel = mongo.createModel<I_Tag>({
    mongoose,
    name: 'Tag',
    pagination: true,
    schema: {
        name: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Name is required',
                },
            ],
        },
        type: {
            type: String,
            enum: Object.values(E_TagType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Type is required',
                },
            ],
        },
        isCustom: {
            type: Boolean,
            default: false,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'isCustom is required',
                },
            ],
        },
        createdById: {
            type: String,
        },
        usageCount: {
            type: Number,
            default: 0,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Usage count is required',
                },
            ],
        },
        translations: {
            type: Object,
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
    ],
});
