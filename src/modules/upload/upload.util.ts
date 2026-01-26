import { path } from '@cyberskill/shared/node/path';

import type { I_Context } from '#shared/typescript/index.js';

import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import {
    E_ModerationMediaStatus,
    E_RiskLevel,
    moderationMediaCtr,
} from '#modules/moderation/index.js';
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

    const shouldAutoReject
        = aiDecision === E_ModerationMediaStatus.REJECTED
            || aiRiskLevel === E_RiskLevel.HIGH
            || aiRiskLevel === E_RiskLevel.CRITICAL;

    const warnReason = !shouldAutoReject && aiReason ? `AI flagged for review: ${aiReason}` : undefined;

    // Get current moderation media to check entity
    const moderationMedia = await moderationMediaCtr.getModerationMedia(context, {
        filter: { id: moderationId },
    });

    if (moderationMedia.success && moderationMedia.result) {
        const entity = moderationMedia.result.entity;
        const isConversation = entity === E_UploadEntity.CONVERSATION;

        const blockedReason = shouldAutoReject
            ? (aiReason ? `AI blocked: ${aiReason}` : 'AI blocked: flagged as high risk content')
            : undefined;

        const pendingReason = warnReason
            ?? (aiDecision === E_ModerationMediaStatus.APPROVED
                ? (aiReason ? `AI reviewed: ${aiReason}` : 'AI reviewed: content appears safe')
                : (blockedReason ?? aiReason));

        let targetStatus: E_ModerationMediaStatus;
        let targetReason: string | undefined;

        if (isConversation) {
            // Conversation media status is always PENDING regardless of AI decision
            targetStatus = E_ModerationMediaStatus.PENDING;
            targetReason = pendingReason;
        }
        else {
            // Other entities (Gallery, etc.) follow AI decision
            if (shouldAutoReject) {
                targetStatus = E_ModerationMediaStatus.REJECTED;
                targetReason = blockedReason;
            }
            else if (aiDecision === E_ModerationMediaStatus.APPROVED) {
                targetStatus = E_ModerationMediaStatus.APPROVED;
                targetReason = pendingReason;
            }
            else {
                // If AI decision is PENDING or unknown, stay PENDING
                targetStatus = E_ModerationMediaStatus.PENDING;
                targetReason = pendingReason;
            }
        }

        const moderationUpdated = await moderationMediaCtr.updateModerationMedia(context, {
            filter: { id: moderationId },
            update: {
                status: targetStatus,
                isPublished: targetStatus === E_ModerationMediaStatus.APPROVED,
                ...(targetReason ? { reason: targetReason } : {}),
            },
        });

        try {
            // Sync status to associated gallery if it exists
            await galleryCtr.updateGallery(context, {
                filter: { moderationMediaId: moderationId },
                update: {
                    status: targetStatus,
                    isPublished: targetStatus === E_ModerationMediaStatus.APPROVED,
                    isDel: targetStatus === E_ModerationMediaStatus.REJECTED,
                },
            });
        }
        catch {
            /* ignore gallery sync errors */
        }

        // Flag user for AI warnings or rejections
        if ((warnReason || shouldAutoReject) && moderationUpdated.success) {
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
