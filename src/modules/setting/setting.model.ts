import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_ModerationCategory } from '#modules/moderation/ai-moderation/ai-moderation.type.js';
import { E_SocialPlatform } from '#modules/social-platform/index.js';

import type { I_AdminNotification, I_AIModerationConfig, I_BannedWordsConfig, I_Footer, I_ImageThresholdsConfig, I_PricingDefault, I_Setting, I_SocialLink } from './setting.type.js';

import { E_SettingType } from './setting.type.js';
import { validateSettingValue } from './setting.validation.js';

export const SocialLinkSchema = mongo.createSchema<I_SocialLink>({
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
            type: [SocialLinkSchema],
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

const ImageThresholdsSchema = mongo.createSchema<I_ImageThresholdsConfig>({
    standalone: true,
    mongoose,
    schema: {
        explicitNudity: { type: Number, default: 0 }, // Nội dung khiêu dâm rõ ràng
        violence: { type: Number, default: 0 }, // Bạo lực
        hateSymbols: { type: Number, default: 0 }, // Biểu tượng thù địch
        drugs: { type: Number, default: 0 }, // Ma túy
        nonExplicitNudity: { type: Number, default: 0 }, // Nội dung khiêu dâm không rõ ràng
        swimwearOrUnderwear: { type: Number, default: 0 }, // Đồ bơi/đồ lót - cho phép với threshold cao
        fullNudity: { type: Number, default: 0 }, // Ảnh khoả thân hoàn toàn
    },
});

const BadSwordSchema = mongo.createSchema<I_BannedWordsConfig>({
    standalone: true,
    mongoose,
    schema: {
        explicit: { type: [String], default: [] },
        hate: { type: [String], default: [] },
        violence: { type: [String], default: [] },
        drugs: { type: [String], default: [] },
        custom: { type: [String], default: [] },
    },
});

export const AIModerationSchema = mongo.createSchema<I_AIModerationConfig>({
    standalone: true,
    mongoose,
    schema: {
        autoRejectThreshold: {
            type: Number,
            default: 0, // Tăng ngưỡng để giảm false positive
        },
        humanReviewThreshold: {
            type: Number,
            default: 0.0, // Ngưỡng review thấp hơn auto reject
        },
        imageThresholds: {
            type: ImageThresholdsSchema,
        },
        moderationCategories: {
            type: [String],
            enum: Object.values(E_ModerationCategory),
        },
        bannedWords: {
            type: BadSwordSchema,
        },
    },
});

export const SettingsModel = mongo.createModel<I_Setting>({
    mongoose,
    name: 'Settings',
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
                    validator(this: { type: E_SettingType }, value: I_Footer | I_AdminNotification | I_AIModerationConfig | I_PricingDefault) {
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
