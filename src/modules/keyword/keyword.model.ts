import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_CategoryKeyword, type I_Keyword } from './keyword.type.js';

export const KeywordModel = mongo.createModel<I_Keyword>({
    mongoose,
    name: 'Keyword',
    pagination: true,
    schema: {
        keyword: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter keyword',
                },
            ],
        },
        category: {
            type: String,
            enum: Object.values(E_CategoryKeyword),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the keyword type',
                },
            ],
        },
        occurrences: {
            type: Number,
            default: 0,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter occurrences for keyword',
                },
            ],
        },
        isActive: {
            type: Boolean,
            default: false,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select is active for keyword',
                },
            ],
        },
    },
});
