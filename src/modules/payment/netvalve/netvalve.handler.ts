import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log } from '@cyberskill/shared/node/log';
import axios from 'axios';
import { Buffer } from 'node:buffer';

import type { I_Context } from '#shared/typescript/express.js';

import { asNumber, asString } from '#shared/util/index.js';

import type { E_PaymentGatewayOperation } from '../payment.type.js';
import type { I_Netvalve3DSProviderResponse, I_NetvalveCredentials, I_NetvalveErrorResponse, I_NetvalveHppOrderPayload, I_NetvalveRoutingPayload } from './index.js';

import { paymentCtr } from '../payment.controller.js';
import { E_PaymentProvider } from '../payment.type.js';
import { E_Netvalve3DSFlow, getNetvalveCredentials, NETVALVE_DEFAULT_TIMEOUT_MS, NETVALVE_HEADER_API_KEY, NETVALVE_HEADER_AUTHORIZATION, NETVALVE_HEADER_CLIENT_ID } from './index.js';

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

    if (!resolved.midId && currency) {
        const fallbackMid = credentials.midByCurrency[currency];
        if (fallbackMid) {
            resolved.midId = fallbackMid;
        }
    }

    return resolved;
}

function normalizeNetvalveError(error: unknown): { message: string; code: number; details?: unknown } {
    if (axios.isAxiosError(error)) {
        const responseData = (error.response?.data ?? {}) as I_NetvalveErrorResponse;
        const responseStatus = error.response?.status;
        const messageFromApi = typeof responseData.message === 'string'
            ? responseData.message
            : undefined;
        const nestedMessages = Array.isArray(responseData.errors)
            ? responseData.errors
                    .map((item) => {
                        if (!item || typeof item !== 'object') {
                            return undefined;
                        }

                        const potentialMessage = typeof item['message'] === 'string' ? item['message'] : undefined;
                        if (potentialMessage) {
                            return potentialMessage;
                        }

                        const potentialCode = typeof item['code'] === 'string' || typeof item['code'] === 'number'
                            ? String(item['code'])
                            : undefined;

                        return potentialCode ? `Code: ${potentialCode}` : undefined;
                    })
                    .filter((value): value is string => Boolean(value))
            : [];

        const codeFromApi = typeof responseData.code === 'string' || typeof responseData.code === 'number'
            ? String(responseData.code)
            : undefined;

        const messageParts: string[] = [];
        if (messageFromApi) {
            messageParts.push(messageFromApi);
        }
        if (codeFromApi) {
            messageParts.push(`Code: ${codeFromApi}`);
        }
        if (nestedMessages.length > 0) {
            messageParts.push(nestedMessages.join(' | '));
        }

        const combinedMessage = messageParts.length > 0
            ? messageParts.join(' - ')
            : 'Netvalve sale request failed';

        return {
            message: combinedMessage,
            code: responseStatus ?? RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
            details: responseData,
        };
    }

    return {
        message: error instanceof Error ? error.message : 'Netvalve sale request failed',
        code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE,
        details: error,
    };
}

export function ensureCredentials(): { credentials?: I_NetvalveCredentials; error?: string } {
    try {
        return { credentials: getNetvalveCredentials() };
    }
    catch (error) {
        return { error: error instanceof Error ? error.message : 'Netvalve credentials are misconfigured' };
    }
}

export async function postNetvalveRequest<T_Response extends Record<string, unknown>>(
    credentials: I_NetvalveCredentials,
    endpoint: string,
    body: Record<string, unknown>,
    action: string,
): Promise<I_Return<T_Response>> {
    const url = `${credentials.baseUrl}${endpoint}`;
    const basicAuthToken = Buffer.from(`${credentials.clientId}:${credentials.apiKey}`).toString('base64');

    try {
        const response = await axios.post<T_Response>(url, body, {
            timeout: NETVALVE_DEFAULT_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
                [NETVALVE_HEADER_CLIENT_ID]: credentials.clientId,
                [NETVALVE_HEADER_API_KEY]: credentials.apiKey,
                [NETVALVE_HEADER_AUTHORIZATION]: `Basic ${basicAuthToken}`,
            },
        });

        return {
            success: true,
            result: response.data,
        };
    }
    catch (errorRequest) {
        const normalized = normalizeNetvalveError(errorRequest);

        log.error(`Netvalve ${action} request failed`, {
            statusCode: normalized.code,
            endpoint,
            details: normalized.details,
        });

        return {
            success: false,
            message: normalized.message,
            code: normalized.code,
        };
    }
}

export async function postNetvalveGetRequest<T_Response extends Record<string, unknown>>(
    credentials: I_NetvalveCredentials,
    endpoint: string,
    query: Record<string, unknown>,
    action: string,
): Promise<I_Return<T_Response>> {
    const url = `${credentials.baseUrl}${endpoint}`;
    const basicAuthToken = Buffer.from(`${credentials.clientId}:${credentials.apiKey}`).toString('base64');

    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') {
            continue;
        }

        if (typeof value === 'object') {
            params[key] = JSON.stringify(value);
            continue;
        }

        params[key] = value as string | number | boolean;
    }

    try {
        const response = await axios.get<T_Response>(url, {
            timeout: NETVALVE_DEFAULT_TIMEOUT_MS,
            params,
            headers: {
                [NETVALVE_HEADER_CLIENT_ID]: credentials.clientId,
                [NETVALVE_HEADER_API_KEY]: credentials.apiKey,
                [NETVALVE_HEADER_AUTHORIZATION]: `Basic ${basicAuthToken}`,
            },
        });

        return {
            success: true,
            result: response.data,
        };
    }
    catch (errorRequest) {
        const normalized = normalizeNetvalveError(errorRequest);

        log.error(`Netvalve ${action} request failed`, {
            statusCode: normalized.code,
            endpoint,
            details: normalized.details,
        });

        return {
            success: false,
            message: normalized.message,
            code: normalized.code,
        };
    }
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

function extractOrderId(source: Record<string, unknown>): string | undefined {
    return asString(
        source['orderId']
        ?? source['clientOrderId']
        ?? source['orderID']
        ?? source['id'],
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

    const transactionId = extractTransactionId({ ...requestPayload, ...(resultPayload ?? {}) });
    const orderId = extractOrderId({ ...requestPayload, ...(resultPayload ?? {}) });

    if (!transactionId && !orderId) {
        return;
    }

    const amount = asNumber(requestPayload['amount'] ?? resultPayload?.['amount']);
    const currencySource = asString(requestPayload['currency']) ?? asString(resultPayload?.['currency']);
    const status = asString(resultPayload?.['status'])
        ?? asString(resultPayload?.['responseCode'])
        ?? asString(resultPayload?.['orderState']);

    const errorCode = response.success
        ? undefined
        : asString((response as { code?: string | number }).code) ?? undefined;

    const errorMessage = response.success ? undefined : response.message;

    try {
        await paymentCtr.recordGatewayTransaction(context, {
            provider: E_PaymentProvider.NETVALVE,
            operation,
            transactionId,
            orderId,
            amount,
            currency: currencySource?.toUpperCase(),
            status,
            success: response.success,
            errorCode: errorCode ?? undefined,
            errorMessage,
            responsePayload: resultPayload ?? null,
            performedAt: new Date(),
        });
    }
    catch (error) {
        log.error('Failed to persist Netvalve payment transaction', {
            error,
            operation,
            transactionId,
            orderId,
        });
    }
}
