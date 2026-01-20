import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';
import { Buffer } from 'node:buffer';

import type { I_PayPalAccessTokenResponse, I_PayPalCredentials, I_PayPalErrorResponse } from './paypal.type.js';

import { getPayPalCredentials } from './paypal.config.js';

const TOKEN_REFRESH_BUFFER_MS = 30_000;

const tokenCache: {
    accessToken: string;
    expiresAt: number;
} = {
    accessToken: '',
    expiresAt: 0,
};

export function ensurePayPalCredentials(): { credentials?: I_PayPalCredentials; error?: string } {
    try {
        return { credentials: getPayPalCredentials() };
    }
    catch (error) {
        return {
            error: error instanceof Error ? error.message : 'PayPal credentials are misconfigured',
        };
    }
}

function buildPayPalErrorMessage(errorData: I_PayPalErrorResponse, fallback: string): string {
    const baseMessage = typeof errorData.message === 'string' && errorData.message.trim()
        ? errorData.message
        : fallback;

    if (Array.isArray(errorData.details) && errorData.details.length > 0) {
        const detail = errorData.details[0];
        if (detail) {
            const detailMessage = typeof detail.description === 'string' && detail.description.trim()
                ? detail.description
                : typeof detail.issue === 'string'
                    ? detail.issue
                    : '';
            if (detailMessage) {
                return `${baseMessage}: ${detailMessage}`;
            }
        }
    }

    return baseMessage;
}

async function fetchPayPal<T>(url: string, options: RequestInit, action: string): Promise<I_Return<T>> {
    try {
        const response = await fetch(url, options);

        if (!response.ok) {
            let errorData: I_PayPalErrorResponse = {};
            try {
                errorData = (await response.json()) as I_PayPalErrorResponse;
            }
            catch {
                // ignore non-JSON errors
            }

            const message = buildPayPalErrorMessage(errorData, response.statusText || 'PayPal request failed');

            log.error(`PayPal ${action} request failed`, {
                statusCode: response.status,
                details: errorData,
            });

            return {
                success: false,
                message,
                code: response.status || RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const text = await response.text();
        let data: T | undefined;
        if (text) {
            try {
                data = JSON.parse(text) as T;
            }
            catch {
                // Some PayPal endpoints might return empty/non-JSON responses; fall back to raw text
                data = text as unknown as T;
            }
        }
        return {
            success: true,
            result: data ?? ({} as T),
        };
    }
    catch (error) {
        log.error(`PayPal ${action} request failed`, { error });
        return {
            success: false,
            message: error instanceof Error ? error.message : 'PayPal request failed',
            code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        };
    }
}

async function getPayPalAccessToken(credentials: I_PayPalCredentials): Promise<I_Return<string>> {
    const now = Date.now();
    if (tokenCache.accessToken && now + TOKEN_REFRESH_BUFFER_MS < tokenCache.expiresAt) {
        return { success: true, result: tokenCache.accessToken };
    }

    const authBaseUrl = credentials.baseUrl.replace(/\/v\d+$/, '');
    const basicToken = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });

    const response = await fetchPayPal<I_PayPalAccessTokenResponse>(
        `${authBaseUrl}/v1/oauth2/token`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicToken}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body.toString(),
        },
        'oauth-token',
    );

    if (!response.success || !response.result?.access_token) {
        return {
            success: false,
            message: response.message ?? 'Failed to retrieve PayPal access token',
            code: response.code ?? RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        };
    }

    const expiresIn = typeof response.result.expires_in === 'number' ? response.result.expires_in : 0;
    tokenCache.accessToken = response.result.access_token;
    tokenCache.expiresAt = now + Math.max(expiresIn * 1000, 0);

    return { success: true, result: tokenCache.accessToken };
}

export async function postPayPalRequest<T>(
    credentials: I_PayPalCredentials,
    endpoint: string,
    payload: Record<string, unknown> | null,
    action: string,
): Promise<I_Return<T>> {
    const tokenRes = await getPayPalAccessToken(credentials);
    if (!tokenRes.success || !tokenRes.result) {
        return {
            success: false,
            message: tokenRes.message ?? 'Failed to authorize PayPal request',
            code: tokenRes.code ?? RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        };
    }

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${tokenRes.result}`,
        'Content-Type': 'application/json',
    };

    const options: RequestInit = {
        method: 'POST',
        headers,
    };

    if (payload) {
        options.body = JSON.stringify(payload);
    }

    return fetchPayPal<T>(`${credentials.baseUrl}${endpoint}`, options, action);
}

export async function getPayPalRequest<T>(
    credentials: I_PayPalCredentials,
    endpoint: string,
    action: string,
): Promise<I_Return<T>> {
    const tokenRes = await getPayPalAccessToken(credentials);
    if (!tokenRes.success || !tokenRes.result) {
        return {
            success: false,
            message: tokenRes.message ?? 'Failed to authorize PayPal request',
            code: tokenRes.code ?? RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        };
    }

    return fetchPayPal<T>(
        `${credentials.baseUrl}${endpoint}`,
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${tokenRes.result}`,
                'Content-Type': 'application/json',
            },
        },
        action,
    );
}
