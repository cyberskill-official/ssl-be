import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Language } from './language.type.js';

export const LanguageModel = mongo.createModel<I_Language>({
    mongoose,
    name: 'Language',
    pagination: true,
    schema: {
        code: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter code for language',
                },
                {
                    validator: mongo.validator.isUnique(['code']),
                    message: 'Code must be unique',
                },
            ],
        },
        name: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter name for language',
                },
                {
                    validator: mongo.validator.isUnique(['name']),
                    message: 'Name must be unique',
                },
            ],
        },
        native: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter native for language',
                },
                {
                    validator: mongo.validator.isUnique(['native']),
                    message: 'Native must be unique',
                },
            ],
        },
        isRTL: {
            type: Boolean,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select isRTL language',
                },
            ],
        },
    },
});
