import mongoose from 'mongoose';
import { mongo } from '@cyberskill/shared/node/mongo';

import type { I_LegalConsent } from './legal-consent.type.js';

export const LegalConsentModel = mongo.createModel<I_LegalConsent>({
    mongoose,
    name: 'LegalConsent',
    pagination: true,
    schema: {
        legalDocumentId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter legalDocumentId for legal consent',
                },
            ],
        },
        userId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter userId for legal consent',
                },
            ],
        },
        version: {
            type: Number,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter version for legal consent',
                },
            ],
        },
    },
    virtuals: [
        {
            name: 'legalDocument',
            options: {
                ref: 'LegalDocument',
                localField: 'legalDocumentId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'user',
            options: {
                ref: 'User',
                localField: 'userId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
