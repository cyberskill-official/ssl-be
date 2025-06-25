import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import { E_SocialPlatform } from '#modules/social-platform/index.js';

import type { I_AdminNotification, I_Footer } from './setting.type.js';

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

export function validateSettingValue(value: I_Footer | I_AdminNotification, settingType: E_SettingType): boolean {
    switch (settingType) {
        case E_SettingType.FOOTER:
            return validateFooter(value as I_Footer);
        case E_SettingType.ADMIN_NOTIFICATION:
            return validateAdminNotification(value as I_AdminNotification);
        default:
            return false;
    }
}
