import { getEnv } from '#shared/env/index.js';

export function getPaymentUrls() {
    const env = getEnv();
    const baseUrl = env.USER_APP_URL.replace(/\/+$/, '');
    const redirectBase = env.PAYMENT_REDIRECT_URL || `${baseUrl}/payment`;

    return {
        successUrl: `${redirectBase}?status=SUCCESS`,
        cancelUrl: `${redirectBase}?status=CANCEL`,
        failedUrl: `${redirectBase}?status=FAILED`,
        pendingUrl: `${redirectBase}?status=PENDING`,
    };
}
