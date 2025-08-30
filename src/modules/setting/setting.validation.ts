import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import { E_SocialPlatform } from '#modules/social-platform/index.js';

import type { I_AdminNotification, I_AIModerationConfig, I_Footer, I_PricingDefault } from './setting.type.js';

import { E_SettingType } from './setting.type.js';

export function validateFooter(value: I_Footer): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    if (value.socialLinks !== undefined) {
        if (!Array.isArray(value.socialLinks)) {
            return false;
        }

        if (value.socialLinks.length === 0) {
            return false;
        }

        const platforms = value.socialLinks.map(link => link.type);
        const uniquePlatforms = new Set(platforms);

        if (uniquePlatforms.size !== platforms.length) {
            return false;
        }

        for (const link of value.socialLinks) {
            if (!link || typeof link !== 'object') {
                return false;
            }

            if (!link.type || !Object.values(E_SocialPlatform).includes(link.type)) {
                return false;
            }

            if (!link.url || typeof link.url !== 'string') {
                return false;
            }
        }
    }

    return true;
}

export function validateAdminNotification(value: I_AdminNotification): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const validKeys = ['successfulPayments', 'failedPayments', 'newMembers'];
    const providedKeys = Object.keys(value);

    for (const key of providedKeys) {
        if (!validKeys.includes(key as keyof I_AdminNotification)) {
            return false;
        }

        if (typeof value[key as keyof I_AdminNotification] !== 'boolean') {
            return false;
        }
    }

    return true;
}

export function validateAIModerationConfig(value: I_AIModerationConfig): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    // Validate global thresholds
    if (typeof value.autoRejectThreshold !== 'number' || value.autoRejectThreshold < 0 || value.autoRejectThreshold > 1) {
        return false;
    }

    if (typeof value.humanReviewThreshold !== 'number' || value.humanReviewThreshold < 0 || value.humanReviewThreshold > 1) {
        return false;
    }

    // Validate image thresholds
    if (value.imageThresholds) {
        const imageThresholdsKeys = ['explicitNudity', 'violence', 'hateSymbols', 'drugs', 'nonExplicitNudity', 'swimwearOrUnderwear'];

        for (const threshold of imageThresholdsKeys) {
            const thresholdValue = (value.imageThresholds as unknown as Record<string, number>)[threshold];

            if (typeof thresholdValue !== 'number' || thresholdValue < 0 || thresholdValue > 1) {
                return false;
            }
        }
    }

    return true;
}

export function validatePricingDefault(value: I_PricingDefault): boolean {
    if (!value || typeof value !== 'object') {
        return false;
    }

    if (typeof value.price !== 'number' || value.price < 0) {
        return false;
    }

    if (typeof value.currency !== 'string') {
        return false;
    }

    if (value.taxRate !== undefined && (typeof value.taxRate !== 'number' || value.taxRate < 0)) {
        return false;
    }

    return true;
}

export function validateFooterBusinessRules(footer: I_Footer): void {
    if (footer.socialLinks && footer.socialLinks.length === 0) {
        throwError({
            message: 'At least one social link is required',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    if (footer.socialLinks) {
        const platforms = footer.socialLinks.map(link => link.type);
        const uniquePlatforms = new Set(platforms);

        if (uniquePlatforms.size !== platforms.length) {
            throwError({
                message: 'Each social platform must be unique in socialLinks',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }

        for (const link of footer.socialLinks) {
            if (!link.type || !link.url) {
                throwError({
                    message: 'Each social link must have both platform and url',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }
    }
}

export function validateAdminNotificationBusinessRules(adminNotification: I_AdminNotification): void {
    if (!adminNotification || typeof adminNotification !== 'object') {
        throwError({
            message: 'Invalid admin notification data',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }
}

export function validateAIModerationBusinessRules(config: I_AIModerationConfig): void {
    if (!config || typeof config !== 'object') {
        throwError({
            message: 'Invalid AI moderation configuration',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    if (config.autoRejectThreshold <= config.humanReviewThreshold) {
        throwError({
            message: 'Auto reject threshold must be higher than human review threshold',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }
}

export function validationPricingDefault(config: I_PricingDefault): void {
    if (!config || typeof config !== 'object') {
        throwError({
            message: 'Invalid Pricing Default configuration',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }
}

export function validateSettingValue(value: I_Footer | I_AdminNotification | I_AIModerationConfig | I_PricingDefault, settingType: E_SettingType): boolean {
    switch (settingType) {
        case E_SettingType.FOOTER:
            return validateFooter(value as I_Footer);
        case E_SettingType.ADMIN_NOTIFICATION:
            return validateAdminNotification(value as I_AdminNotification);
        case E_SettingType.AI_MODERATION:
            return validateAIModerationConfig(value as I_AIModerationConfig);
        case E_SettingType.PRICING_DEFAULT:
            return validatePricingDefault(value as I_PricingDefault);
        default:
            return false;
    }
}
