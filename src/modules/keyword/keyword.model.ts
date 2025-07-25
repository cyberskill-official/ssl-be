import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Keyword } from './keyword.type.js';

import { E_KeywordCategory } from './keyword.type.js';

export const KeywordModel = mongo.createModel<I_Keyword>({
    mongoose,
    name: 'Keyword',
    schema: {
        word: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter word',
                },
            ],
        },
        category: {
            type: String,
            enum: Object.values(E_KeywordCategory),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select word category',
                },
            ],
        },
        occurrences: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: false,
        },
    },
});
