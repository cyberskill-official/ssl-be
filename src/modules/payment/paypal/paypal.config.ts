import { getEnv } from '#shared/env/index.js';

import type { I_PayPalCredentials } from './paypal.type.js';

export function getPayPalCredentials(): I_PayPalCredentials {
    const env = getEnv();
    const clientId = env.PAYPAL_CLIENT_ID?.trim();
    const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
    let baseUrl = env.PAYPAL_API_BASE_URL?.trim();

    // Tự động chọn URL nếu không được cung cấp thủ công
    if (!baseUrl) {
        const isProd = env['NODE_ENV'] === 'production';
        baseUrl = isProd
            ? 'https://api-m.paypal.com/v2'
            : 'https://api-m.sandbox.paypal.com/v2';
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

    if (!clientId || !clientSecret) {
        throw new Error('Missing PayPal client credentials (PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET)');
    }

    return {
        baseUrl: normalizedBaseUrl,
        clientId,
        clientSecret,
    };
}
