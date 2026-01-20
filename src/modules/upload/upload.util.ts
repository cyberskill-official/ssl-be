import { path } from '@cyberskill/shared/node/path';

import type { I_Context } from '#shared/typescript/index.js';

import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import {
    E_ModerationMediaStatus,
    E_RiskLevel,
    moderationMediaCtr,
} from '#modules/moderation/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import {
    E_NotificationEntityType,
    E_NotificationType,
} from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';
import { E_UploadEntity } from '#shared/typescript/index.js';

import type { I_UploadPathConfig } from './upload.type.js';

export function generateUploadPath(baseDir: string, config: I_UploadPathConfig): string {
    const { entity, type, entityId, userId } = config;

    switch (entity) {
        case E_UploadEntity.USER: {
            return path.posix.join(baseDir, entity, entityId || userId || 'anonymous', type.toLowerCase());
        }
        case E_UploadEntity.CONVERSATION: {
            if (!entityId) {
                throw new Error('Entity ID is required for conversation uploads');
            }

            return path.posix.join(baseDir, entity, entityId, userId || 'anonymous', type.toLowerCase());
        }
        case E_UploadEntity.EVENT: {
            if (!entityId) {
                throw new Error('Entity ID is required for event uploads');
            }

            return path.posix.join(baseDir, entity, entityId, type.toLowerCase());
        }
        case E_UploadEntity.CATALOGUE: {
            if (!entityId) {
                throw new Error('Entity ID is required for catalogue uploads');
            }

            return path.posix.join(baseDir, entity, entityId, type.toLowerCase());
        }
        case E_UploadEntity.CLUB: {
            if (!entityId) {
                throw new Error('Entity ID is required for club uploads');
            }

            return path.posix.join(baseDir, entity, entityId, type.toLowerCase());
        }
        default: {
            return path.posix.join(baseDir, String(entity).toLowerCase(), entityId || 'general', type.toLowerCase());
        }
    }
}

export function composeAiReason(result: any): string | undefined {
    if (result?.reasons && Array.isArray(result.reasons) && result.reasons.length > 0) {
        return result.reasons.join(', ');
    }

    if (result?.moderationLabels && Array.isArray(result.moderationLabels) && result.moderationLabels.length > 0) {
        return result.moderationLabels
            .map((label: any) => `${label.name}${typeof label.confidence === 'number' ? ` (${label.confidence.toFixed?.(1) ?? label.confidence}%)` : ''}`)
            .join(', ');
    }

    return undefined;
}

export async function applyAiModerationDecision(
    context: I_Context,
    moderationId: string,
    aiResult: any,
): Promise<boolean> {
    if (!aiResult || !moderationId) {
        return false;
    }

    const aiDecision = aiResult.decision as E_ModerationMediaStatus | undefined;
    const aiRiskLevel = aiResult.riskLevel as E_RiskLevel | undefined;
    const aiReason = composeAiReason(aiResult);

    // Auto-approve images with LOW risk level
    const shouldAutoApprove = aiRiskLevel === E_RiskLevel.LOW;

    const shouldAutoReject
        = aiDecision === E_ModerationMediaStatus.REJECTED
            || aiRiskLevel === E_RiskLevel.HIGH
            || aiRiskLevel === E_RiskLevel.CRITICAL;

    const autoRejectReason = shouldAutoReject
        ? aiReason ? `AI blocked: ${aiReason}` : 'AI blocked: flagged as high risk content'
        : undefined;
    const warnReason = !shouldAutoReject && aiReason ? `AI flagged for review: ${aiReason}` : undefined;

    // Auto-approve safe content (LOW risk)
    if (shouldAutoApprove) {
        await moderationMediaCtr.updateModerationMedia(context, {
            filter: { id: moderationId },
            update: {
                status: E_ModerationMediaStatus.APPROVED,
                reason: aiReason ? `AI approved: ${aiReason}` : 'AI approved: safe content',
                isPublished: true,
            },
        });

        try {
            await galleryCtr.updateGallery(context, {
                filter: { moderationMediaId: moderationId },
                update: {
                    status: E_ModerationMediaStatus.APPROVED,
                    isPublished: true,
                    isDel: false,
                },
            });
        }
        catch {
            /* ignore gallery sync errors */
        }

        return false; // Not rejected
    }

    if (shouldAutoReject) {
        const moderationUpdated = await moderationMediaCtr.updateModerationMedia(context, {
            filter: { id: moderationId },
            update: {
                status: E_ModerationMediaStatus.REJECTED,
                reason: autoRejectReason,
                isPublished: false,
                isDel: true,
            },
        });

        if (moderationUpdated.success && moderationUpdated.result?.uploadedById) {
            const ownerId = moderationUpdated.result.uploadedById;

            await notificationCtr.createNotification(context, {
                doc: {
                    targetId: ownerId,
                    type: [E_NotificationType.MODERATION_MEDIA_REJECTED],
                    entityType: E_NotificationEntityType.MEDIA,
                    entityId: moderationUpdated.result.entityId ?? undefined,
                    presentation: {
                        headline: 'We\'re conducting a routine spot check of your image. It will be posted once approved.',
                        context: {
                            profileOwnerId: ownerId,
                        },
                        thumbnailUrl: moderationUpdated.result.url,
                    },
                },
            });

            // Red-flag the profile when AI removes media
            // Only flag if confidence > 70% or risk level is HIGH/CRITICAL
            const confidence = aiResult.confidence;
            const riskLevel = aiResult.riskLevel;
            const shouldFlag = (confidence !== undefined && confidence > 0.7)
                || riskLevel === E_RiskLevel.HIGH
                || riskLevel === E_RiskLevel.CRITICAL;

            if (shouldFlag) {
                try {
                    await userCtr.updateUser(context, {
                        filter: { id: ownerId },
                        update: {
                            $inc: { flagCount: 1 },
                        } as any,
                    });
                }
                catch {
                    /* best-effort; do not block moderation flow */
                }
            }
        }

        try {
            await galleryCtr.updateGallery(context, {
                filter: { moderationMediaId: moderationId },
                update: {
                    status: E_ModerationMediaStatus.REJECTED,
                    isPublished: false,
                    isDel: true,
                },
            });
        }
        catch {
            /* ignore gallery sync errors */
        }
    }
    else if (warnReason) {
        const moderationUpdated = await moderationMediaCtr.updateModerationMedia(context, {
            filter: { id: moderationId },
            update: { reason: warnReason },
        });

        // Flag user for AI warnings as well (non-removal)
        if (moderationUpdated.success) {
            const ownerId = moderationUpdated.result?.uploadedById;
            if (ownerId) {
                try {
                    await userCtr.updateUser(context, {
                        filter: { id: ownerId },
                        update: {
                            $inc: { flagCount: 1 },
                        } as any,
                    });
                }
                catch {
                    /* best-effort */
                }
            }
        }
    }

    return shouldAutoReject;
}
