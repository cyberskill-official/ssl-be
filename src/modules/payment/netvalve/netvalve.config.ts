import { getEnv } from '#shared/env/index.js';

import type { I_NetvalveCredentials } from './netvalve.type.js';

/**
 * Default HPP base URL for Netvalve Hosted Payment Page.
 * This is ONLY used for createOrder (HPP order creation).
 * Other operations (sale, refund, etc.) use NETVALVE_API_BASE_URL.
 */
const NETVALVE_DEFAULT_HPP_BASE_URL = 'https://hpp-api.netvalve.com';

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

    // HPP base URL priority (for HPP order creation ONLY):
    // 1. Use NETVALVE_HPP_BASE_URL if explicitly set (allows override for testing)
    // 2. Always use default HPP URL: https://hpp-api.netvalve.com
    // Note: HPP order endpoint is separate from main API and always uses hpp-api.netvalve.com
    const resolvedHppBaseUrl = env.NETVALVE_HPP_BASE_URL?.trim()
        ? normalizeUrl(env.NETVALVE_HPP_BASE_URL)!
        : (normalizeUrl(NETVALVE_DEFAULT_HPP_BASE_URL) ?? 'https://hpp-api.netvalve.com');

    // Payment API base URL (for GET /order and /orders endpoints):
    // UAT uses payment-api.uat.sandbox-netvalve.com, Production uses api.netvalve.com
    let resolvedPaymentApiBaseUrl: string | undefined;
    if (resolvedBaseUrl.includes('uat') || resolvedBaseUrl.includes('sandbox')) {
        // UAT: use payment-api subdomain
        resolvedPaymentApiBaseUrl = 'https://payment-api.uat.sandbox-netvalve.com';
    }
    // Production: use baseUrl (api.netvalve.com) - no need to set separately

    return {
        baseUrl: resolvedBaseUrl,
        hppBaseUrl: resolvedHppBaseUrl,
        paymentApiBaseUrl: resolvedPaymentApiBaseUrl,
        clientId,
        apiKey,
        siteId: env.NETVALVE_SITE_ID?.trim() || undefined,
        midByCurrency,
    };
}
