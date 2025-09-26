import type { I_Gallery } from '#modules/gallery/gallery.type.js';

import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';

import type { I_Notification } from './notification.type.js';

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

export function hasInApp(n: I_Notification): boolean {
    return Array.isArray(n.channels) && n.channels.includes(E_NotificationChannel.IN_APP);
}
