import { getEnv } from '#shared/env/index.js';

import type { I_PayPalCredentials } from './paypal.type.js';

export function getPayPalCredentials(): I_PayPalCredentials {
    const env = getEnv();
    const rawBaseUrl = env.PAYPAL_API_BASE_URL?.trim();
    const clientId = env.PAYPAL_CLIENT_ID?.trim();
    const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
    const normalizedBaseUrl = rawBaseUrl?.replace(/\/+$/, '') ?? '';

    if (!rawBaseUrl) {
        throw new Error('Missing PAYPAL_API_BASE_URL environment variable');
    }
    if (!clientId || !clientSecret) {
        throw new Error('Missing PayPal client credentials');
    }

    return {
        baseUrl: normalizedBaseUrl,
        clientId,
        clientSecret,
    };
}
