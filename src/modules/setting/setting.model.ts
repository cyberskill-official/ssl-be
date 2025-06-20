import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_SocialPlatform } from '#modules/social-platform/index.js';

import type { I_AdminNotification, I_Footer, I_Setting, I_SocialLink } from './setting.type.js';

const SocialLinksSchema = mongo.createSchema<I_SocialLink>({
    standalone: true,
    mongoose,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_SocialPlatform),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select social platform for footer',
                },
            ],
        },
        url: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter social link for footer',
                },
            ],
        },
    },
});

const FooterSchema = mongo.createSchema<I_Footer>({
    standalone: true,
    mongoose,
    schema: {
        socialLinks: {
            type: [SocialLinksSchema],
        },
    },
});

const AdminNotificationSchema = mongo.createSchema<I_AdminNotification>({
    standalone: true,
    mongoose,
    schema: {
        successfulPayments: {
            type: Boolean,
            default: true,
        },
        failedPayments: {
            type: Boolean,
            default: true,
        },
        newMembers: {
            type: Boolean,
            default: true,
        },
    },
});

export const SettingsModel = mongo.createModel<I_Setting>({
    mongoose,
    name: 'Settings',
    pagination: true,
    schema: {
        footer: {
            type: FooterSchema,
        },
        adminNotification: {
            type: AdminNotificationSchema,
        },
    },
});
