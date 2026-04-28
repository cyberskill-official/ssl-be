import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_LegalDocument, I_LegalDocumentHistory } from './legal-document.type.js';

import { E_LegalDocumentStatus, E_LegalDocumentType } from './legal-document.type.js';

export const LegalDocumentHistorySchema = mongo.createSchema<I_LegalDocumentHistory>({
    standalone: true,
    mongoose,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_LegalDocumentType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter type for legal document',
                },
            ],
        },
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content for legal document',
                },
            ],
        },
        version: {
            type: Number,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter version for legal document',
                },
            ],
        },
        updatedAt: {
            type: Date,
            default: Date.now,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter updatedAt for legal document',
                },
            ],
        },
        updatedById: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter updatedById for legal document',
                },
            ],
        },
    },
    virtuals: [{
        name: 'updatedBy',
        options: {
            ref: 'User',
            localField: 'updatedById',
            foreignField: 'id',
            justOne: true,
        },
    }],
});

export const LegalDocumentModel = mongo.createModel<I_LegalDocument>({
    mongoose,
    name: 'LegalDocument',
    schema: {
        type: {
            type: String,
            enum: Object.values(E_LegalDocumentType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter type for legal document',
                },
            ],
        },
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content for legal document',
                },
            ],
        },
        status: {
            type: String,
            enum: Object.values(E_LegalDocumentStatus),
            default: 'DRAFT',
        },
        version: {
            type: Number,
            default: 1,
        },
        history: {
            type: [LegalDocumentHistorySchema],
        },
    },
});
