import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Setting } from '#modules/setting/setting.type.js';

import { E_SettingType } from '#modules/setting/index.js';

/**
 * Update AI Moderation thresholds to reduce false positives
 * - Increased thresholds for explicit content detection
 * - Added video-specific thresholds
 * - Improved logic for text detection in images
 * - Added auto-approve for low-risk videos
 */

const updatedModerationConfig = {
    // Global thresholds
    autoRejectThreshold: 0.999, // Keep very high to avoid false auto-rejects
    humanReviewThreshold: 0.65,

    // AWS services
    awsComprehendEnabled: true,
    awsRekognitionEnabled: true,
    enableImageModeration: true,
    enableTextModeration: true,
    enableVideoModeration: true,

    // Image thresholds - increased to reduce false positives
    imageThresholds: {
        // Explicit content - very high threshold to reduce false positives
        explicitNudity: 0.95, // Increased from 0.75 to catch real violations but reduce false positives
        fullNudity: 0.98, // Increased from 0.95
        violence: 0.85, // Increased from 0.70 to reduce false positives on action scenes
        hateSymbols: 0.90, // Increased from 0.80
        drugs: 0.90, // Increased from 0.75 to reduce false positives on innocent items

        // Non-explicit content - higher threshold to allow lifestyle content
        nonExplicitNudity: 0.95, // Reduced from 0.85 but still high - allow artistic/lifestyle content
        swimwearOrUnderwear: 0.95, // Increased from 0.90 - beach/pool photos are OK
    },

    // Video-specific thresholds (more lenient as context matters more in video)
    videoThresholds: {
        explicitNudity: 0.90,
        violence: 0.85,
        significantLabelConfidence: 70, // Only consider labels with >70% confidence (up from 60)
        autoApproveMaxConfidence: 0.40, // Auto-approve videos with confidence < 40%
    },
};

/**
 * @param db {C_Db}
 * @returns {Promise<void>}
 */
export async function up(db: C_Db): Promise<void> {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');

    // Update existing AI moderation setting
    const updated = await settingCtr.updateOne(
        { type: E_SettingType.AI_MODERATION },
        { value: updatedModerationConfig },
    );

    if (!updated.success) {
        return log.error('Failed to update AI moderation thresholds');
    }

    log.success('✅ AI moderation thresholds updated successfully - reduced false positives');
}

/**
 * @param db {C_Db}
 * @returns {Promise<void>}
 */
export async function down(db: C_Db): Promise<void> {
    const settingCtr = new MongoController<I_Setting>(db, 'settings');

    // Rollback to previous thresholds
    const previousConfig = {
        autoRejectThreshold: 0.85,
        humanReviewThreshold: 0.65,
        imageThresholds: {
            explicitNudity: 0.75,
            violence: 0.70,
            hateSymbols: 0.80,
            drugs: 0.75,
            nonExplicitNudity: 0.85,
            swimwearOrUnderwear: 0.90,
            fullNudity: 0.95,
        },
    };

    const rolledBack = await settingCtr.updateOne(
        { type: E_SettingType.AI_MODERATION },
        { value: previousConfig },
    );

    if (!rolledBack.success) {
        return log.error('Failed to rollback AI moderation thresholds');
    }

    log.success('AI moderation thresholds rolled back to previous version');
}
