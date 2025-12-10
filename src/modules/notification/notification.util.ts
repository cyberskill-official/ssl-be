import type { I_Gallery } from '#modules/gallery/gallery.type.js';

import { bunnyCtr } from '#modules/bunny/bunny.controller.js';
import { E_GalleryType } from '#modules/gallery/gallery.type.js';

import type { I_Notification } from './notification.type.js';

import {
    E_NotificationChannel,
    E_RedirectType,
} from './notification.type.js';

const REDIRECT_WHITELIST = new Set(Object.values(E_RedirectType));

export function safeRedirect(r?: { kind?: string; id?: string }) {
    if (r?.id && r?.kind && REDIRECT_WHITELIST.has(r.kind as E_RedirectType)) {
        return { kind: r.kind as E_RedirectType, id: r.id };
    }
    return undefined;
}

export function buildNotifThumbnail(g: I_Gallery): string | undefined {
    if (!g)
        return undefined;

    if (g.type === E_GalleryType.IMAGE && g.url) {
        return bunnyCtr.generateBlurredUrl({
            fullUrl: g.url,
            extraQueryParams: { class: 'blur' },
        });
    }

    if (g.type === E_GalleryType.VIDEO) {
        if (g.thumbnailUrl) {
            return bunnyCtr.generateSignedUrl({
                fullUrl: g.thumbnailUrl,
                extraQueryParams: { class: 'free' },
            });
        }
        return undefined;
    }

    return undefined;
}

export function hasInApp(n: I_Notification): boolean {
    return Array.isArray(n.channels) && n.channels.includes(E_NotificationChannel.IN_APP);
}

export function isValidMap(m?: { latitude?: number; longitude?: number }) {
    return (
        m
        && typeof m.latitude === 'number' && Number.isFinite(m.latitude)
        && typeof m.longitude === 'number' && Number.isFinite(m.longitude)
    );
}
