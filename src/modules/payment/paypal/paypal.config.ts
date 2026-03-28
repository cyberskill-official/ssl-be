import { getEnv } from '#shared/env/index.js';

import type { I_PayPalCredentials } from './paypal.type.js';

const TRAILING_SLASHES_REGEX = /\/+$/;
const VERSION_SUFFIX_REGEX = /\/v\d+$/;

export function getPayPalCredentials(): I_PayPalCredentials {
    const env = getEnv();
    const clientId = env.PAYPAL_CLIENT_ID?.trim();
    const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
    let baseUrl = env.PAYPAL_API_BASE_URL?.trim();

    // Tự động chọn URL nếu không được cung cấp thủ công
    if (!baseUrl) {
        const isProd = env['NODE_ENV'] === 'production';
        baseUrl = isProd
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
    }

    // Accept values like https://api-m.paypal.com, .../v1 or .../v2 and normalize to host root.
    const normalizedBaseUrl = baseUrl
        .replace(TRAILING_SLASHES_REGEX, '')
        .replace(VERSION_SUFFIX_REGEX, '');

    if (!clientId || !clientSecret) {
        throw new Error('Missing PayPal client credentials (PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET)');
    }

    return {
        baseUrl: normalizedBaseUrl,
        clientId,
        clientSecret,
    };
}
