import type { I_Gallery } from '#modules/gallery/gallery.type.js';

import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';

import type { I_Notification } from './index.js';

import { E_NotificationEntityType, E_RedicrectType } from './index.js';

export function deriveRedirect(n: I_Notification) {
    switch (n.entityType) {
        case E_NotificationEntityType.MEDIA:
            return { kind: E_RedicrectType.MEDIA, id: n.entityId };
        case E_NotificationEntityType.BLOG:
            return { kind: E_RedicrectType.BLOG, id: n.entityId };
        case E_NotificationEntityType.PODCAST:
            return { kind: E_RedicrectType.PODCAST, id: n.entityId };
        case E_NotificationEntityType.ANNOUNCEMENT:
            return { kind: E_RedicrectType.EVENT, id: n.entityId };
        case E_NotificationEntityType.CONVERSATION:
        case E_NotificationEntityType.MESSAGE_THREAD:
            return { kind: E_RedicrectType.CONVERSATION, id: n.entityId };
        case E_NotificationEntityType.GUESTBOOK_ENTRY:
            return { kind: E_RedicrectType.GUESTBOOK_ENTRY, id: n.entityId };
        default:
            return n.actorId ? { kind: E_RedicrectType.PROFILE, id: n.actorId } : undefined;
    }
}

const WHITELIST = new Set(Object.values(E_RedicrectType));
export function safeRedirect(r?: { kind?: string; id?: string }) {
    if (r?.id && r?.kind && WHITELIST.has(r.kind as E_RedicrectType)) {
        return { kind: r.kind as E_RedicrectType, id: r.id };
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
