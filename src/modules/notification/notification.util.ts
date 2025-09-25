import type { I_Gallery } from '#modules/gallery/gallery.type.js';
import type { I_Context } from '#shared/typescript/express.js';

import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';
import { userCtr } from '#modules/user/user.controller.js';

import type { I_Notification, I_NotificationPresentation } from './notification.type.js';

import {
    E_NotificationChannel,
    E_NotificationEntityType,
    E_RedirectType,
} from './notification.type.js';

export function deriveRedirect(n: I_Notification) {
    switch (n.entityType) {
        case E_NotificationEntityType.MEDIA:
            return { kind: E_RedirectType.MEDIA, id: n.entityId };
        case E_NotificationEntityType.BLOG:
            return { kind: E_RedirectType.BLOG, id: n.entityId };
        case E_NotificationEntityType.PODCAST:
            return { kind: E_RedirectType.PODCAST, id: n.entityId };
        case E_NotificationEntityType.ANNOUNCEMENT:
            return { kind: E_RedirectType.EVENT, id: n.entityId };
        case E_NotificationEntityType.CONVERSATION:
        case E_NotificationEntityType.MESSAGE_THREAD:
            return { kind: E_RedirectType.CONVERSATION, id: n.entityId };
        case E_NotificationEntityType.GUESTBOOK_ENTRY:
            return { kind: E_RedirectType.GUESTBOOK_ENTRY, id: n.entityId };
        default:
            return n.actorId ? { kind: E_RedirectType.PROFILE, id: n.actorId } : undefined;
    }
}

const REDIRECT_WHITELIST = new Set(Object.values(E_RedirectType));
export function safeRedirect(r?: { kind?: string; id?: string }) {
    if (r?.id && r?.kind && REDIRECT_WHITELIST.has(r.kind as E_RedirectType)) {
        return { kind: r.kind as E_RedirectType, id: r.id };
    }
    return undefined;
}

// Whitelist CDN để nhận thumbnail/avatar từ hint một cách an toàn
function isTrustedCdn(u?: string): boolean {
    try {
        const host = new URL(String(u)).hostname;
        // Cập nhật theo hạ tầng CDN của bạn
        return ['cdn.yourdomain.com', 'media.bunnycdn.com'].includes(host);
    }
    catch {
        return false;
    }
}

export function buildNotifThumbnail(g: I_Gallery): string | undefined {
    if (!g?.url)
        return undefined;

    if (g.type === E_GalleryType.IMAGE) {
        return bunnyCtr.generateSignedUrl({
            fullUrl: g.url,
            extraQueryParams: { class: 'normal' },
        });
    }
    if (g.type === E_GalleryType.VIDEO) {
        // poster nhẹ cho bell, không iframe
        return bunnyCtr.generateSignedUrl({
            fullUrl: g.url,
            extraQueryParams: { class: 'free' },
        });
    }
    return undefined;
}

export async function buildPresentation(
    context: I_Context,
    notification: I_Notification,
    presentationHint?: I_NotificationPresentation,
): Promise<I_NotificationPresentation> {
    const presentation: I_NotificationPresentation = { id: notification.id };

    /* 1) ACTOR (populate từ DB + fallback sang hint) */
    let actorUsername: string | undefined;
    let actorAccountType: string | undefined;
    let actorAvatarUrl: string | undefined;

    // a) lấy từ DB nếu có actorId
    if (notification.actorId) {
        try {
            const actorFound = await userCtr.getUser(context, {
                filter: { id: notification.actorId },
                // BẮT BUỘC: populate để có gallery.url
                populate: [
                    {
                        path: 'partner1',
                        select: 'id galleryId',
                        populate: [{ path: 'gallery', select: 'id url' }],
                    },
                    {
                        path: 'partner2',
                        select: 'id galleryId',
                        populate: [{ path: 'gallery', select: 'id url' }],
                    },
                ],
            });

            if (actorFound.success) {
                const actor = actorFound.result;
                actorUsername = actor.username;
                actorAccountType = actor.accountType;

                const rawAvatar
                    = actor.partner1?.gallery?.url
                        ?? actor.partner2?.gallery?.url
                        ?? undefined;

                if (rawAvatar) {
                    actorAvatarUrl = bunnyCtr.generateSignedUrl({
                        fullUrl: rawAvatar,
                        extraQueryParams: { class: 'normal' },
                    });
                }
            }
        }
        catch {
            // ignore
        }
    }

    // b) fallback sang hint nếu DB không có avatar/username/accountType
    if (!actorUsername && presentationHint?.actor?.username) {
        actorUsername = presentationHint.actor.username;
    }
    if (!actorAccountType && presentationHint?.actor?.accountType) {
        actorAccountType = presentationHint.actor.accountType;
    }
    if (!actorAvatarUrl && presentationHint?.actor?.avatarUrl && isTrustedCdn(presentationHint.actor.avatarUrl)) {
        actorAvatarUrl = presentationHint.actor.avatarUrl;
    }

    if (actorUsername || actorAccountType || actorAvatarUrl) {
        presentation.actor = {
            username: actorUsername,
            accountType: actorAccountType,
            avatarUrl: actorAvatarUrl,
        };
    }

    /* 2) THUMBNAIL (hint hợp lệ -> derive cho MEDIA) */
    try {
        if (presentationHint?.thumbnailUrl && isTrustedCdn(presentationHint.thumbnailUrl)) {
            presentation.thumbnailUrl = presentationHint.thumbnailUrl;
        }
        else if (notification.entityType === E_NotificationEntityType.MEDIA && notification.entityId) {
            const galleryFound = await galleryCtr.getGallery(context, { filter: { id: notification.entityId } });
            if (galleryFound.success && galleryFound.result?.url) {
                presentation.thumbnailUrl = buildNotifThumbnail(galleryFound.result) ?? undefined;
            }
        }
    }
    catch {
        // ignore
    }

    /* 3) Redirect: safe override -> derive */
    presentation.redirect = safeRedirect(presentationHint?.redirect) ?? deriveRedirect(notification);

    return presentation;
}

export function hasInApp(n: I_Notification): boolean {
    return Array.isArray(n.channels) && n.channels.includes(E_NotificationChannel.IN_APP);
}
