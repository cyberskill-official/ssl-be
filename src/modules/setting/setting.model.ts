import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_SocialPlatform } from '#modules/social-platform/index.js';

import type { I_AdminNotification, I_Footer, I_Setting, I_SocialLink } from './setting.type.js';

import { E_SettingType } from './setting.type.js';
import { validateSettingValue } from './setting.validation.js';

export const SocialLinksSchema = mongo.createSchema<I_SocialLink>({
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

export const FooterSchema = mongo.createSchema<I_Footer>({
    standalone: true,
    mongoose,
    schema: {
        socialLinks: {
            type: [SocialLinksSchema],
        },
    },
});

export const AdminNotificationSchema = mongo.createSchema<I_AdminNotification>({
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
        type: {
            type: String,
            enum: Object.values(E_SettingType),
            required: true,
        },
        value: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
            validate: [
                {
                    validator(this: { type: E_SettingType }, value: I_Footer | I_AdminNotification) {
                        if (!this.type) {
                            return true;
                        }
                        return validateSettingValue(value, this.type);
                    },
                    message: 'Value does not match the expected schema for the given type',
                },
            ],
        },
    },
});
