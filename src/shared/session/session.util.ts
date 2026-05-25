import type { IncomingHttpHeaders } from 'node:http';

import type { I_Environment } from '#shared/env/index.js';

import { E_SessionPortal, SESSION_PORTAL_HEADER } from './session.constant.js';

interface I_SessionRequestLike {
    headers?: IncomingHttpHeaders;
    get?: (name: string) => string | undefined;
}

function getHeader(req: I_SessionRequestLike, name: string): string | undefined {
    const headerFromGetter = req.get?.(name);

    if (headerFromGetter) {
        return headerFromGetter;
    }

    const headerValue = req.headers?.[name.toLowerCase()];

    return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function normalizeOrigin(value?: string): string | undefined {
    if (!value) {
        return undefined;
    }

    try {
        return new URL(value).origin;
    }
    catch {
        return value.replace(/\/+$/, '');
    }
}

export function getPortalSessionCookieNames(env: I_Environment): Record<E_SessionPortal, string> {
    return {
        [E_SessionPortal.ADMIN]: env.SESSION_NAME_ADMIN,
        [E_SessionPortal.USER]: env.SESSION_NAME_USER,
    };
}

export function getSessionPortalFromRequest(req: I_SessionRequestLike, env: I_Environment): E_SessionPortal {
    const portalHeader = getHeader(req, SESSION_PORTAL_HEADER)?.toLowerCase();

    if (portalHeader === E_SessionPortal.ADMIN || portalHeader === E_SessionPortal.USER) {
        return portalHeader;
    }

    const requestOrigin = normalizeOrigin(getHeader(req, 'origin')) || normalizeOrigin(getHeader(req, 'referer'));

    if (!requestOrigin) {
        return E_SessionPortal.USER;
    }

    const userOrigin = normalizeOrigin(env.USER_APP_URL);

    if (userOrigin && requestOrigin === userOrigin) {
        return E_SessionPortal.USER;
    }

    const adminOrigins = env.ADMIN_PANEL_ORIGINS
        .map(origin => normalizeOrigin(origin))
        .filter((origin): origin is string => Boolean(origin));

    if (adminOrigins.includes(requestOrigin)) {
        return E_SessionPortal.ADMIN;
    }

    const backendOrigin = normalizeOrigin(`http://localhost:${env.PORT}`);
    const whitelistedOrigins = env.CORS_WHITELIST
        .map(origin => normalizeOrigin(origin))
        .filter((origin): origin is string => Boolean(origin));

    if (whitelistedOrigins.includes(requestOrigin) && requestOrigin !== userOrigin && requestOrigin !== backendOrigin) {
        return E_SessionPortal.ADMIN;
    }

    return E_SessionPortal.USER;
}
