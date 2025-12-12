import { getEnv } from '#shared/env/index.js';

import type { I_NetvalveCredentials } from './netvalve.type.js';

export function getNetvalveCredentials(): I_NetvalveCredentials {
    const env = getEnv();

    // Per requirement: use only these two env vars
    // NETVALVE_API_SANDBOX_BASE_URL -> payment API base (e.g. https://payment-api.uat.sandbox-netvalve.com)
    // NETVALVE_API_HPP_BASE_URL     -> HPP base (e.g. https://hpp-api.uat.sandbox-netvalve.com)
    const apiBaseUrl = env.NETVALVE_API_SANDBOX_BASE_URL?.trim();
    const hppBaseUrl = env.NETVALVE_API_HPP_BASE_URL?.trim();
    const clientId = env.NETVALVE_CLIENT_ID?.trim();
    const apiKey = env.NETVALVE_API_KEY?.trim();

    if (!apiBaseUrl) {
        throw new Error('Missing NETVALVE_API_SANDBOX_BASE_URL environment variable');
    }
    if (!hppBaseUrl) {
        throw new Error('Missing NETVALVE_API_HPP_BASE_URL environment variable');
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

    const resolvedBaseUrl = normalizeUrl(apiBaseUrl)!; // Payment API base
    const resolvedHppBaseUrl = normalizeUrl(hppBaseUrl)!; // HPP base

    return {
        baseUrl: resolvedBaseUrl,
        hppBaseUrl: resolvedHppBaseUrl,
        // For GET /order and /orders, use payment API base (same as baseUrl here)
        paymentApiBaseUrl: resolvedBaseUrl,
        clientId,
        apiKey,
        siteId: env.NETVALVE_SITE_ID?.trim() || undefined,
        midByCurrency,
    };
}
