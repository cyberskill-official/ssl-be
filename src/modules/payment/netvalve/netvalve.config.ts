import { getEnv } from '#shared/env/index.js';

import type { I_NetvalveCredentials } from './netvalve.type.js';

export function getNetvalveCredentials(): I_NetvalveCredentials {
    const env = getEnv();

    const baseUrl = env.NETVALVE_API_BASE_URL?.trim();
    const clientId = env.NETVALVE_CLIENT_ID?.trim();
    const apiKey = env.NETVALVE_API_KEY?.trim();

    if (!baseUrl) {
        throw new Error('Missing NETVALVE_API_BASE_URL environment variable');
    }
    if (!clientId || !apiKey) {
        throw new Error('Missing Netvalve client credentials');
    }

    const midByCurrency: Partial<Record<string, string>> = {};
    if (env.NETVALVE_MID_EUR) {
        midByCurrency['EUR'] = env.NETVALVE_MID_EUR;
    }
    if (env.NETVALVE_MID_USD) {
        midByCurrency['USD'] = env.NETVALVE_MID_USD;
    }

    return {
        baseUrl: baseUrl.replace(/\/?$/, ''),
        clientId,
        apiKey,
        siteId: env.NETVALVE_SITE_ID?.trim() || undefined,
        midByCurrency,
    };
}
