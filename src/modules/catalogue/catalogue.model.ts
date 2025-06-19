import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Catalogue } from './catalogue.type.js';

import { E_CatalogueType } from './catalogue.type.js';

export const CatalogueModel = mongo.createModel<I_Catalogue>({
    mongoose,
    name: 'Catalogue',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_CatalogueType),
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
    ],
});
