import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_ModerationCategory } from '#modules/moderation/index.js';
import type { E_SocialPlatform } from '#modules/social-platform/index.js';

export enum E_SettingType {
    FOOTER = 'FOOTER',
    ADMIN_NOTIFICATION = 'ADMIN_NOTIFICATION',
    AI_MODERATION = 'AI_MODERATION',
    PRICING_DEFAULT = 'PRICING_DEFAULT',
}

export interface I_SocialLink {
    type: E_SocialPlatform;
    url: string;
}

export interface I_Footer {
    socialLinks?: I_SocialLink[];
}

export interface I_AdminNotification {
    successfulPayments?: boolean;
    failedPayments?: boolean;
    newMembers?: boolean;
}

export interface I_ImageThresholdsConfig {
    explicitNudity: number;
    violence: number;
    hateSymbols: number;
    drugs: number;
    nonExplicitNudity: number;
    swimwearOrUnderwear: number; // Thêm threshold cho swimwear
    fullNudity: number; // Threshold cho ảnh khoả thân hoàn toàn
}

export interface I_BannedWordsConfig {
    explicit: string[];
    hate: string[];
    violence: string[];
    drugs: string[];
    custom: string[];
}

export interface I_AIModerationConfig {
    // Global thresholds
    autoRejectThreshold: number; // 0.0 - 1.0
    humanReviewThreshold: number; // 0.0 - 1.0
    // Content type specific thresholds
    imageThresholds: I_ImageThresholdsConfig;
    // Banned words configuration
    bannedWords?: I_BannedWordsConfig;
    // Additional settings
    moderationCategories?: E_ModerationCategory;
}

export interface I_PricingDefault {
    currency: string;
    price: number;
    taxRate?: number;
}

export interface I_Setting extends I_GenericDocument {
    type: E_SettingType;
    value: I_Footer | I_AdminNotification | I_AIModerationConfig | I_PricingDefault;
}

export interface I_GraphQLSettingValue {
    footer?: I_Footer;
    adminNotification?: I_AdminNotification;
    aiModeration?: I_AIModerationConfig;
    pricingDefault?: I_PricingDefault;
}

export interface I_GraphQLSetting extends I_GenericDocument {
    type: E_SettingType;
    value: I_GraphQLSettingValue;
}

export interface I_Input_QuerySetting extends I_Setting { }

export interface I_Input_CreateSetting extends Omit<I_Setting, T_Omit_Create> { }

export interface I_Input_UpdateSetting extends Omit<I_Setting, T_Omit_Update> { }

export interface I_Input_QuerySettingGraphQL extends I_GraphQLSetting { }

export interface I_Input_CreateSettingGraphQL extends Omit<I_GraphQLSetting, T_Omit_Create> { }

export interface I_Input_UpdateSettingGraphQL extends Omit<I_GraphQLSetting, T_Omit_Update> { }
