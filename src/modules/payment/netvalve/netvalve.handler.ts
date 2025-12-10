import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/express.js';

import { asString } from '#shared/util/index.js';

import type { I_Netvalve3DSProviderResponse, I_NetvalveCredentials, I_NetvalveErrorResponse, I_NetvalveHppOrderPayload, I_NetvalveRoutingPayload } from './index.js';

import { E_PaymentGatewayOperation, E_PaymentProvider, E_PaymentStatus } from '../payment-transaction/index.js';
import { paymentCtr } from '../payment-transaction/payment-transaction.controller.js';
import { E_Netvalve3DSFlow, getNetvalveCredentials, NETVALVE_HEADER_API_KEY, NETVALVE_HEADER_CLIENT_ID } from './index.js';

export function applyMerchantRouting<T extends I_NetvalveRoutingPayload & Record<string, unknown>>(
    payload: T,
    credentials: I_NetvalveCredentials,
): T {
    const resolved: T = { ...payload };

    if (!resolved.siteId && credentials.siteId) {
        resolved.siteId = credentials.siteId;
    }

    if (!resolved.siteId && !resolved.netvalveMidId) {
        const currency = typeof resolved.currency === 'string'
            ? resolved.currency.toUpperCase()
            : '';
        const fallbackMid = currency ? credentials.midByCurrency[currency] : undefined;
        if (fallbackMid) {
            resolved.netvalveMidId = fallbackMid;
        }
    }

    return resolved;
}

export function applyHppMerchantRouting(
    payload: I_NetvalveHppOrderPayload,
    credentials: I_NetvalveCredentials,
): I_NetvalveHppOrderPayload {
    const resolved: I_NetvalveHppOrderPayload = { ...payload };

    const currency = typeof resolved.currency === 'string'
        ? resolved.currency.toUpperCase()
        : '';

    // Set netvalveMidId based on currency (EUR -> NETVALVE_MID_EUR, USD -> NETVALVE_MID_USD)
    // netvalveMidId is a UUID string (e.g., "af14c6a4-55df-44bf-a0f6-6252f1fe890b")
    if (!resolved.netvalveMidId && currency) {
        const fallbackMid = credentials.midByCurrency[currency];
        if (fallbackMid) {
            resolved.netvalveMidId = fallbackMid;
        }
    }

    return resolved;
}

async function fetchNetvalve<T>(url: string, options: RequestInit, action: string): Promise<I_Return<T>> {
    try {
        const response = await fetch(url, options);

        if (!response.ok) {
            let errorData: I_NetvalveErrorResponse = {};
            try {
                errorData = (await response.json()) as I_NetvalveErrorResponse;
            }
            catch {
                // Ignore JSON parse errors
            }

            const message = typeof errorData.message === 'string' ? errorData.message : response.statusText || 'Netvalve request failed';
            log.error(`Netvalve ${action} request failed`, {
                statusCode: response.status,
                details: errorData,
            });

            return {
                success: false,
                message,
                code: response.status || RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            };
        }

        const data = await response.json() as T;
        return {
            success: true,
            result: data,
        };
    }
    catch (error) {
        log.error(`Netvalve ${action} request failed`, { error });
        return {
            success: false,
            message: error instanceof Error ? error.message : 'Netvalve request failed',
            code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        };
    }
}

export function ensureCredentials(): { credentials?: I_NetvalveCredentials; error?: string } {
    try {
        return { credentials: getNetvalveCredentials() };
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : 'Netvalve credentials are misconfigured' };
    }
}

/**
 * Post request to Netvalve HPP endpoint.
 * Headers: netvalve-client-id, netvalve-api-key
 */
export async function postNetvalveHppRequest<T_Response extends Record<string, unknown>>(
    credentials: I_NetvalveCredentials,
    endpoint: string,
    body: Record<string, unknown>,
    action: string,
    overrideBaseUrl?: string,
): Promise<I_Return<T_Response>> {
    // HPP requests should use hppBaseUrl, not baseUrl
    const baseUrl = overrideBaseUrl ?? credentials.hppBaseUrl ?? credentials.baseUrl;
    // Ensure endpoint starts with / if baseUrl doesn't end with /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = `${normalizedBaseUrl}${normalizedEndpoint}`;

    log.info('[Netvalve HPP] Request URL:', {
        baseUrl,
        hppBaseUrl: credentials.hppBaseUrl,
        endpoint,
        normalizedBaseUrl,
        normalizedEndpoint,
        finalUrl: url,
        action,
    });

    return fetchNetvalve<T_Response>(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [NETVALVE_HEADER_CLIENT_ID]: credentials.clientId,
            [NETVALVE_HEADER_API_KEY]: credentials.apiKey,
        },
        body: JSON.stringify(body),
    }, action);
}

/**
 * Post request to Netvalve Payment Service API endpoints.
 * Headers: netvalve-client-id, netvalve-api-key
 */
export async function postNetvalveRequest<T_Response extends Record<string, unknown>>(
    credentials: I_NetvalveCredentials,
    endpoint: string,
    body: Record<string, unknown>,
    action: string,
    overrideBaseUrl?: string,
): Promise<I_Return<T_Response>> {
    const url = `${overrideBaseUrl ?? credentials.baseUrl}${endpoint}`;

    return fetchNetvalve<T_Response>(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [NETVALVE_HEADER_CLIENT_ID]: credentials.clientId,
            [NETVALVE_HEADER_API_KEY]: credentials.apiKey,
        },
        body: JSON.stringify(body),
    }, action);
}

/**
 * Get request to Netvalve Payment Service API endpoints.
 * Headers: netvalve-client-id, netvalve-api-key
 */
export async function postNetvalveGetRequest<T_Response extends Record<string, unknown>>(
    credentials: I_NetvalveCredentials,
    endpoint: string,
    query: Record<string, unknown>,
    action: string,
): Promise<I_Return<T_Response>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }

    const url = `${credentials.baseUrl}${endpoint}${params.toString() ? `?${params.toString()}` : ''}`;

    return fetchNetvalve<T_Response>(url, {
        method: 'GET',
        headers: {
            [NETVALVE_HEADER_CLIENT_ID]: credentials.clientId,
            [NETVALVE_HEADER_API_KEY]: credentials.apiKey,
        },
    }, action);
}

export function resolveThreeDSFlow(provider: I_Netvalve3DSProviderResponse | null | undefined) {
    const status = typeof provider?.status === 'string' ? provider.status.toUpperCase() : '';
    const challengeRequired = provider?.challengeRequired === true || status === 'ACS_REQUIRED';
    const hasFrictionlessValues = Boolean(provider?.eci && provider?.cavv);
    const transID = provider?.transID ?? null;

    if (hasFrictionlessValues) {
        return {
            flow: E_Netvalve3DSFlow.FRICTIONLESS_SALE,
            context: {
                transID,
                eci: provider?.eci ?? null,
                cavv: provider?.cavv ?? null,
            },
        } as const;
    }

    if (challengeRequired) {
        return {
            flow: E_Netvalve3DSFlow.CHALLENGE,
            context: {
                transID,
                redirectUrl: provider?.redirectUrl ?? provider?.acsURL ?? null,
                acsURL: provider?.acsURL ?? null,
                status,
            },
        } as const;
    }

    if (status === 'INITIALIZED') {
        return {
            flow: E_Netvalve3DSFlow.DEVICE_DATA_COLLECTION,
            context: {
                transID,
                redirectUrl: provider?.redirectUrl ?? null,
                status,
            },
        } as const;
    }

    return {
        flow: E_Netvalve3DSFlow.UNKNOWN,
        context: {
            transID,
            status,
        },
    } as const;
}

function extractTransactionId(source: Record<string, unknown>): string | undefined {
    return asString(
        source['transactionId']
        ?? source['transactionID']
        ?? source['transID']
        ?? source['transId']
        ?? source['threeDs2TransactionId']
        ?? source['referenceId'],
    );
}

export async function recordNetvalveTransaction(
    context: I_Context,
    operation: E_PaymentGatewayOperation,
    requestPayload: Record<string, unknown>,
    response: I_Return<unknown>,
): Promise<void> {
    const rawResult = (response as { result?: unknown }).result;
    const resultPayload = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
        ? rawResult as Record<string, unknown>
        : null;

    // For HPP_ORDER, prioritize clientOrderId from request as it's always available
    // This ensures we can record the transaction even when Netvalve returns an error
    let transactionId: string | undefined;

    if (operation === E_PaymentGatewayOperation.HPP_ORDER) {
        // First try to get transactionId from response (Netvalve's transactionID or orderId)
        transactionId = extractTransactionId(resultPayload ?? {});

        // If not found in response, try orderId from response
        if (!transactionId && resultPayload) {
            transactionId = asString(resultPayload['orderId']);
        }

        // Fallback to clientOrderId from request (our internal order ID)
        // This is always available and ensures we can record failed transactions
        if (!transactionId) {
            transactionId = asString(requestPayload['clientOrderId']);
        }
    }
    else {
        // For other operations, use standard extraction
        transactionId = extractTransactionId({ ...requestPayload, ...(resultPayload ?? {}) });
    }

    if (!transactionId) {
        log.warn('Cannot record Netvalve transaction: missing transactionId', { operation, requestPayload, resultPayload });
        return;
    }

    // Extract status from responsePayload
    // Priority: orderState > responseCode mapping
    // GTW_1000 with orderState PAID/SUCCESS = SUCCESS
    // GTW_1000 with orderState CREATED/PENDING = PENDING
    // Other responseCode = FAILED
    const responseCode = asString(resultPayload?.['responseCode']);
    const orderState = asString(resultPayload?.['orderState']);

    let status: E_PaymentStatus | undefined;

    if (responseCode === 'GTW_1000') {
        // GTW_1000 means transaction approved, check orderState for final status
        if (orderState === 'PAID' || orderState === 'SUCCESS') {
            status = E_PaymentStatus.SUCCESS;
        }
        else if (orderState === 'CREATED' || orderState === 'PENDING') {
            status = E_PaymentStatus.PENDING;
        }
        else {
            // Default to SUCCESS for GTW_1000 if orderState is unknown
            status = E_PaymentStatus.SUCCESS;
        }
    }
    else if (orderState) {
        // Map orderState directly if responseCode is not GTW_1000
        if (orderState === 'PAID' || orderState === 'SUCCESS') {
            status = E_PaymentStatus.SUCCESS;
        }
        else if (orderState === 'FAILED') {
            status = E_PaymentStatus.FAILED;
        }
        else if (orderState === 'CREATED' || orderState === 'PENDING') {
            status = E_PaymentStatus.PENDING;
        }
        else if (orderState === 'CANCELLED' || orderState === 'CANCELED') {
            status = E_PaymentStatus.CANCELED;
        }
    }
    else {
        // Fallback: try to map status string directly
        const statusString = asString(resultPayload?.['status']);
        if (statusString && Object.values(E_PaymentStatus).includes(statusString as E_PaymentStatus)) {
            status = statusString as E_PaymentStatus;
        }
    }

    const errorCode = response.success
        ? undefined
        : asString((response as { code?: string | number }).code) ?? undefined;

    const errorMessage = response.success ? undefined : response.message;

    try {
        await paymentCtr.recordGatewayTransaction(context, {
            // cspell:ignore NETVALVE
            provider: E_PaymentProvider.NETVALVE,
            operation,
            transactionId,
            status,
            success: response.success,
            errorCode,
            errorMessage,
            responsePayload: {
                request: requestPayload,
                response: resultPayload,
            },
            performedAt: new Date(),
        });
    }
    catch (error) {
        log.error('Failed to persist Netvalve payment transaction', {
            error,
            operation,
            transactionId,
        });
    }
}
