import { getEnv } from '#shared/env/index.js';

import type { I_NetvalveCredentials } from './netvalve.type.js';

/**
 * Default HPP base URL for Netvalve Hosted Payment Page.
 * This is ONLY used for createOrder (HPP order creation).
 * Other operations (sale, refund, etc.) use NETVALVE_API_BASE_URL.
 */
const NETVALVE_DEFAULT_HPP_BASE_URL = 'https://hpp-api.uat.sandbox-netvalve.com/';

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

    const normalizeUrl = (value?: string | null): string | undefined => {
        if (!value) {
            return undefined;
        }
        return value.replace(/\/+$/, '');
    };

    const midByCurrency: Partial<Record<string, string>> = {};
    if (env.NETVALVE_MID_EUR) {
        midByCurrency['EUR'] = env.NETVALVE_MID_EUR;
    }
    if (env.NETVALVE_MID_USD) {
        midByCurrency['USD'] = env.NETVALVE_MID_USD;
    }

    const resolvedBaseUrl = normalizeUrl(baseUrl)!;
    const resolvedHppBaseUrl = (resolvedBaseUrl.includes('/hpp') ? resolvedBaseUrl : normalizeUrl(NETVALVE_DEFAULT_HPP_BASE_URL));

    return {
        baseUrl: resolvedBaseUrl,
        hppBaseUrl: resolvedHppBaseUrl,
        clientId,
        apiKey,
        siteId: env.NETVALVE_SITE_ID?.trim() || undefined,
        midByCurrency,
    };
}
