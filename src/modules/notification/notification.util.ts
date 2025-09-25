import type { I_Gallery } from '#modules/gallery/gallery.type.js';
import type { I_Context } from '#shared/typescript/express.js';

import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { galleryCtr } from '#modules/gallery/gallery.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';
import { userCtr } from '#modules/user/user.controller.js';

import type { I_Notification, I_NotificationPresentation } from './index.js';

import { E_NotificationChannel, E_NotificationEntityType, E_RedirectType } from './notification.type.js';

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

const WHITELIST = new Set(Object.values(E_RedirectType));
export function safeRedirect(r?: { kind?: string; id?: string }) {
    if (r?.id && r?.kind && WHITELIST.has(r.kind as E_RedirectType)) {
        return { kind: r.kind as E_RedirectType, id: r.id };
    }
    return undefined;
}

export function buildNotifThumbnail(g: I_Gallery): string | undefined {
    if (!g.url) {
        return undefined;
    }
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

interface NotificationData {
    mediaType?: 'image' | 'video';
    videoEmbedUrl?: string;
    [k: string]: unknown;
}

// Whitelist CDN để nhận thumbnailUrl từ hint một cách an toàn
function isTrustedCdn(u?: string): boolean {
    try {
        const host = new URL(String(u)).hostname;
        return ['cdn.yourdomain.com', 'media.bunnycdn.com'].includes(host);
    }
    catch {
        return false;
    }
}

export async function buildPresentation(
    context: I_Context,
    notification: I_Notification,
    presentationHint?: I_NotificationPresentation,
): Promise<I_NotificationPresentation> {
    const presentation: I_NotificationPresentation = {};

    // actor snapshot
    if (notification.actorId) {
        const actorFound = await userCtr.getUser(context, { filter: { id: notification.actorId } });
        if (actorFound.success) {
            const actor = actorFound.result;

            const rawUrls: Array<string | undefined> = [
                actor.partner1?.gallery?.url,
                actor.partner2?.gallery?.url,
            ];

            const avatarUrls: string[] = [];
            for (const u of rawUrls) {
                if (!u)
                    continue;
                try {
                    avatarUrls.push(
                        bunnyCtr.generateSignedUrl({
                            fullUrl: u,
                            extraQueryParams: { class: 'normal' },
                        }),
                    );
                }
                catch { /* ignore */ }
            }

            presentation.actor = {
                accountType: actor.accountType,
                avatarUrls: avatarUrls.length ? avatarUrls : undefined,
            };
        }
    }

    // thumbnail (ưu tiên hint nếu hợp lệ, nếu không derive từ gallery)
    let thumbnailUrl: string | undefined;
    try {
        if (presentationHint?.thumbnailUrl && isTrustedCdn(presentationHint.thumbnailUrl)) {
            thumbnailUrl = presentationHint.thumbnailUrl;
        }
        else if (notification.entityType === E_NotificationEntityType.MEDIA && notification.entityId) {
            const galleryFound = await galleryCtr.getGallery(context, { filter: { id: notification.entityId } });
            if (galleryFound.success && galleryFound.result.url) {
                const dataObj = (notification.data ??= {}) as NotificationData;
                if (galleryFound.result.type === E_GalleryType.IMAGE) {
                    thumbnailUrl = bunnyCtr.generateSignedUrl({
                        fullUrl: galleryFound.result.url,
                        extraQueryParams: { class: 'normal' },
                    });
                    dataObj.mediaType = 'image';
                }
                else if (galleryFound.result.type === E_GalleryType.VIDEO) {
                    // Chuông chỉ dùng thumbnail/poster đã ký — không iframe
                    thumbnailUrl = bunnyCtr.generateSignedUrl({
                        fullUrl: galleryFound.result.url,
                        extraQueryParams: { class: 'free' },
                    });
                    dataObj.mediaType = 'video';
                }
            }
        }
    }
    catch {
    /* ignore */
    }

    if (thumbnailUrl) {
        presentation.thumbnailUrl = thumbnailUrl;
    }

    // redirect: ưu tiên override an toàn, nếu không derive
    presentation.redirect = safeRedirect(presentationHint?.redirect) ?? deriveRedirect(notification);

    // headline
    if (notification.title) {
        presentation.headline = notification.title;
    }

    return presentation;
}

export function hasInApp(n: I_Notification): boolean {
    return Array.isArray(n.channels) && n.channels.includes(E_NotificationChannel.IN_APP);
}
