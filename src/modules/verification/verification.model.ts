import { mongo } from '@cyberskill/shared/node/mongo';
import { validate } from '@cyberskill/shared/util';
import mongoose from 'mongoose';

import type { I_Verification, I_VerificationMeta } from './verification.type.js';

import { E_VerificationContext, E_VerificationMethod, E_VerificationPlatform } from './verification.type.js';

export const VerificationMetaSchema = mongo.createSchema<I_VerificationMeta>({
    standalone: true,
    mongoose,
    schema: {
        context: {
            type: String,
            enum: Object.values(E_VerificationContext),
            default: E_VerificationContext.SIGNUP,
        },
        platform: {
            type: String,
            enum: Object.values(E_VerificationPlatform),
            default: E_VerificationPlatform.WEB,
        },
        ip: {
            type: String,
            validate: [
                {
                    validator: (value: string) => validate.isValidIP(value),
                    message: 'Invalid IP address format.',
                },
            ],
        },
        userAgent: {
            type: String,
        },
        location: {
            country: { type: String },
            city: { type: String },
        },
        extra: {
            type: Object,
            default: {},
        },
    },
});

export const VerificationModel = mongo.createModel<I_Verification>({
    mongoose,
    name: 'Verification',
    pagination: true,
    schema: {
        identifier: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Verification identifier is required.',
                },
            ],
        },
        value: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Verification value is required.',
                },
            ],
        },
        method: {
            type: String,
            enum: Object.values(E_VerificationMethod),
            default: E_VerificationMethod.EMAIL_OTP,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Verification method is required.',
                },
            ],
        },
        attemptCount: {
            type: Number,
            default: 0,
            min: [0, 'Attempt count cannot be negative'],
        },
        maxAttempts: {
            type: Number,
            default: 3,
            validate: [
                {
                    validator: (value: number) => value > 0,
                    message: 'Max attempts must be greater than 0',
                },
            ],
        },
        expiresAt: {
            type: Date,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Expires date is required.',
                },
                {
                    validator: (date: Date) => date > new Date(),
                    message: 'Expiration date must be in the future.',
                },
            ],
        },
        meta: {
            type: VerificationMetaSchema,
            default: {},
        },
    },
});
