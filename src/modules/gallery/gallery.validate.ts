import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { E_Role_User } from '#modules/authz/index.js';
import { followCtr } from '#modules/follow/follow.controller.js';
import { E_ModerationMediaStatus } from '#modules/moderation/index.js';
import { notificationCtr } from '#modules/notification/notification.controller.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { buildNotifThumbnail } from '#modules/notification/notification.util.js';
import { userCtr } from '#modules/user/index.js';

import type { I_Gallery } from './gallery.type.js';

export async function assertCanUploadVideo(context: I_Context, uploadedById?: string): Promise<void> {
    if (!uploadedById)
        return;

    const uploaderFound = await userCtr.getUser(context, {
        filter: { id: uploadedById },
        populate: [{ path: 'roles' }],
    });

    if (!uploaderFound.success) {
        throwError({
            message: 'Uploader not found.',
            status: RESPONSE_STATUS.BAD_REQUEST,
        });
    }

    const roles = uploaderFound.result.roles ?? [];
    const roleNames = roles
        .map(role => role?.name)
        .filter((name): name is E_Role_User => Boolean(name));

    const hasFreeRole = roleNames.includes(E_Role_User.FREE_MEMBER);
    const hasPaidRole = roleNames.includes(E_Role_User.PAID_MEMBER);

    if (hasFreeRole && !hasPaidRole) {
        throwError({
            message: 'Free members can upload images only.',
            status: RESPONSE_STATUS.FORBIDDEN,
        });
    }
}

export function shouldSendPublishNotification(gallery: I_Gallery): boolean {
    const statusApproved
        = !gallery.status || gallery.status === E_ModerationMediaStatus.APPROVED;
    const explicitlyHidden = gallery.isPublished === false;
    return statusApproved && !explicitlyHidden;
}

export async function notifyGalleryFollowersOnPublish(context: I_Context, gallery: I_Gallery): Promise<void> {
    const uploaderId = gallery.uploadedById;

    if (!uploaderId) {
        return;
    }

    try {
        const followers = await followCtr.getFollowers(context, {
            filter: { followId: uploaderId },
            options: { pagination: false },
        });

        const uploaderFound = await userCtr.getUser(context, { filter: { id: uploaderId } });

        if (!uploaderFound.success) {
            return;
        }

        const uploaderName = uploaderFound.result.username ?? '';

        if (followers.success) {
            const thumbnailUrl = buildNotifThumbnail(gallery);

            for (const f of followers.result.docs) {
                const targetId = f.userId;
                if (!targetId || targetId === uploaderId)
                    continue;

                await notificationCtr.createNotificationWithSettings(context, {
                    doc: {
                        targetId,
                        type: [E_NotificationType.FOLLOWED_PROFILE_POSTED_MEDIA],
                        entityType: E_NotificationEntityType.MEDIA,
                        entityId: gallery.id,
                        actorId: uploaderId,
                        presentation: {
                            redirect: { kind: E_RedirectType.MEDIA, id: gallery.id },
                            ...(thumbnailUrl ? { thumbnailUrl } : {}),
                            actor: {
                                username: uploaderName,
                                accountType: uploaderFound.result.accountType,
                                avatarUrl: uploaderFound.result.partner1?.gallery?.url,
                                gender: uploaderFound.result.partner1?.gender,
                            },
                        },
                    },
                });
            }
        }
    }
    catch {
        /* ignore notification errors */
    }
}
