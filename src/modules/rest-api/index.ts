import { express, Router } from '@cyberskill/shared/node/express';

import type {
    E_NetvalvePaymentType,
    I_Netvalve3DSAuthenticationPayload,
    I_Netvalve3DSInitializationPayload,
    I_Netvalve3DSInitializationResponse,
    I_Netvalve3DSProviderResponse,
    I_Netvalve3DSResultPayload,
    I_NetvalveAuthorizePayload,
    I_NetvalveCancelPayload,
    I_NetvalveCapturePayload,
    I_NetvalveCreateTokenPayload,
    I_NetvalveGetOrderQuery,
    I_NetvalveGetOrdersQuery,
    I_NetvalveGetTransactionQuery,
    I_NetvalveGetTransactionsQuery,
    I_NetvalveHppOrderPayload,
    I_NetvalveQueryTransactionStatusQuery,
    I_NetvalveRebillPayload,
    I_NetvalveRefundPayload,
    I_NetvalveSalePayload,
} from '#modules/payment/netvalve/netvalve.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import orderCtr from '#modules/order/order.controller.js';
import { isNetvalvePaymentType, NETVALVE_PAYMENT_TYPES } from '#modules/payment/netvalve/netvalve.constant.js';
import { netvalveCtr } from '#modules/payment/netvalve/netvalve.controller.js';
import { resolveThreeDSFlow } from '#modules/payment/netvalve/netvalve.handler.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import {
    E_PaymentGatewayOperation,
    E_PaymentProvider,
    E_PaymentStatus,
} from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { paymentRouter } from '#modules/payment/payment.handler.js';
import { pricingCtr } from '#modules/pricing/pricing.controller.js';
import { getEnv } from '#shared/env/index.js';

const env = getEnv();

const mainRouter = Router();

mainRouter.use(express.json({ limit: env.BODY_PARSER_LIMIT }));

mainRouter.get('/', (_req, res) => {
    res.status(200).json({ message: 'Connected!' });
});

const truthyQueryValues = new Set(['true', '1', 'yes']);
const falsyQueryValues = new Set(['false', '0', 'no']);

function normalizeBooleanQuery(value: unknown, fieldName: string, errors: string[]): boolean | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const source = Array.isArray(value) ? value[0] : value;

    if (typeof source === 'boolean') {
        return source;
    }

    if (typeof source === 'string') {
        const normalized = source.trim().toLowerCase();
        if (!normalized) {
            return undefined;
        }

        if (truthyQueryValues.has(normalized)) {
            return true;
        }

        if (falsyQueryValues.has(normalized)) {
            return false;
        }
    }

    errors.push(`${fieldName} must be a boolean value`);
    return undefined;
}

function normalizePositiveNumber(value: unknown, fieldName: string, errors: string[], { required }: { required: boolean }): number | undefined {
    const source = Array.isArray(value) ? value[0] : value;

    if (source === undefined || source === null || source === '') {
        if (required) {
            errors.push(`${fieldName} is required`);
        }
        return undefined;
    }

    const resolved = typeof source === 'number'
        ? source
        : typeof source === 'string'
            ? Number(source)
            : Number.NaN;

    if (!Number.isFinite(resolved) || resolved <= 0) {
        errors.push(`${fieldName} must be a positive number`);
        return undefined;
    }

    return resolved;
}

function normalizeFiltersQuery(value: unknown, fieldName: string, errors: string[]): Record<string, unknown> | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const source = Array.isArray(value) ? value[0] : value;

    if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
        return source as Record<string, unknown>;
    }

    if (typeof source === 'string') {
        const trimmed = source.trim();
        if (!trimmed) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }

            errors.push(`${fieldName} must be a JSON object`);
            return undefined;
        }
        catch {
            errors.push(`${fieldName} must be a valid JSON object`);
            return undefined;
        }
    }

    errors.push(`${fieldName} must be a JSON object`);
    return undefined;
}

mainRouter.post('/payment/netvalve/hpp/order', async (req, res, next) => {
    try {
        const {
            amount,
            currency,
            clientOrderId,
            successUrl,
            cancelUrl,
            failedUrl,
            pendingUrl,
            orderDesc,
            midId,
            customerDetails,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        let resolvedAmount
            = typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;

        let resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';

        // If amount not provided or invalid, derive price from pricing controller using user's persisted geo
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            try {
                const context: I_Context = { req };
                const priceRes = await pricingCtr.getSubscriptionPrice(context);
                if (priceRes.success && priceRes.result) {
                    resolvedAmount = priceRes.result.price ?? resolvedAmount;
                    resolvedCurrency = priceRes.result.currency ?? resolvedCurrency;
                }
            }
            catch (err) {
                // fallback: record error and continue validation
                console.warn('Failed to resolve pricing for HPP order:', err);
            }
        }

        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            errors.push('amount must be a positive number');
        }

        if (!resolvedCurrency) {
            errors.push('currency is required');
        }

        const resolvedClientOrderId = typeof clientOrderId === 'string' ? clientOrderId.trim() : '';
        if (!resolvedClientOrderId) {
            errors.push('clientOrderId is required');
        }

        const resolvedSuccessUrl = typeof successUrl === 'string' ? successUrl.trim() : '';
        if (!resolvedSuccessUrl) {
            errors.push('successUrl is required');
        }

        const resolvedCancelUrl = typeof cancelUrl === 'string' ? cancelUrl.trim() : '';
        if (!resolvedCancelUrl) {
            errors.push('cancelUrl is required');
        }

        const resolvedFailedUrl = typeof failedUrl === 'string' ? failedUrl.trim() : '';
        if (!resolvedFailedUrl) {
            errors.push('failedUrl is required');
        }

        const resolvedPendingUrl = typeof pendingUrl === 'string' ? pendingUrl.trim() : '';
        const resolvedOrderDesc = typeof orderDesc === 'string' ? orderDesc.trim() : '';
        const resolvedMidId = typeof midId === 'string' ? midId.trim() : '';

        let normalizedCustomerDetails: Record<string, string> | undefined;
        if (customerDetails !== undefined) {
            if (!customerDetails || typeof customerDetails !== 'object' || Array.isArray(customerDetails)) {
                errors.push('customerDetails must be an object when provided');
            }
            else {
                const collected: Record<string, string> = {};
                for (const [key, value] of Object.entries(customerDetails)) {
                    if (value === undefined || value === null) {
                        continue;
                    }

                    if (typeof value === 'string') {
                        const trimmed = value.trim();
                        if (trimmed) {
                            collected[key] = trimmed;
                        }
                        continue;
                    }

                    collected[key] = String(value);
                }

                if (Object.keys(collected).length > 0) {
                    normalizedCustomerDetails = collected;
                }
            }
        }

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveHppOrderPayload = {
            ...normalizedPayload,
            amount: resolvedAmount,
            currency: resolvedCurrency,
            clientOrderId: resolvedClientOrderId,
            successUrl: resolvedSuccessUrl,
            cancelUrl: resolvedCancelUrl,
            failedUrl: resolvedFailedUrl,
        };

        if (resolvedPendingUrl) {
            payload.pendingUrl = resolvedPendingUrl;
        }

        if (resolvedOrderDesc) {
            payload.orderDesc = resolvedOrderDesc;
        }

        if (resolvedMidId) {
            payload.midId = resolvedMidId;
        }

        if (normalizedCustomerDetails) {
            payload.customerDetails = normalizedCustomerDetails;
        }

        const context: I_Context = { req };

        // 1) persist an Order record for this request
        const orderDoc: Record<string, unknown> = {
            amount: resolvedAmount,
            currency: resolvedCurrency,
            successUrl: resolvedSuccessUrl,
            cancelUrl: resolvedCancelUrl,
            pendingUrl: resolvedPendingUrl,
            externalGateway: 'NETVALVE',
            clientOrderId: resolvedClientOrderId,
        };

        if (normalizedCustomerDetails) {
            (orderDoc as any)['customerDetails'] = normalizedCustomerDetails;
        }

        const orderRes = await orderCtr.createOrder(context, { doc: orderDoc });
        if (!orderRes.success) {
            res.status(typeof orderRes.code === 'number' ? orderRes.code : 500).json({ success: false, message: orderRes.message ?? 'Failed to create order' });
            return;
        }

        const createdOrder = orderRes.result ?? null;

        // 2) idempotent PaymentRequest: try reuse WAITING by clientOrderId
        const existingPr = await paymentRequestCtr.getPaymentRequest(context, { filter: { clientOrderId: resolvedClientOrderId, status: E_PaymentRequestStatus.WAITING } });
        let paymentRequestResult = existingPr;
        if (!existingPr.success || !existingPr.result) {
            const prDoc: Record<string, unknown> = {
                orderId: createdOrder?._id ?? createdOrder?.id,
                clientOrderId: resolvedClientOrderId,
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                gateway: 'NETVALVE',
                status: E_PaymentRequestStatus.WAITING,
                attempts: 0,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000), // default 30 minutes
            };

            paymentRequestResult = await paymentRequestCtr.createPaymentRequest(context, { doc: prDoc });
        }

        if (!paymentRequestResult.success || !paymentRequestResult.result) {
            res.status(500).json({ success: false, message: 'Failed to create or retrieve payment session' });
            return;
        }

        const paymentRequest = paymentRequestResult.result;

        // 3) call Netvalve to create HPP session
        const response = await netvalveCtr.createOrder(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            // record failed gateway transaction
            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: E_PaymentGatewayOperation.HPP_ORDER,
                transactionId: undefined,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: E_PaymentStatus.FAILED,
                success: false,
                errorMessage: response.message ?? 'Netvalve HPP order creation failed',
                responsePayload: (failureResult as Record<string, unknown>) ?? null,
            });

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve HPP order creation failed',
                result: failureResult,
            });
            return;
        }

        const resultPayload = response.result ?? null;
        const responseCode
            = resultPayload && typeof resultPayload === 'object' && 'responseCode' in resultPayload
                && typeof resultPayload.responseCode === 'string'
                ? resultPayload.responseCode
                : '';

        if (responseCode && responseCode !== 'GTW_1000') {
            // record unexpected gateway response
            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: E_PaymentGatewayOperation.HPP_ORDER,
                transactionId: undefined,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: E_PaymentStatus.FAILED,
                success: false,
                errorMessage: `Netvalve returned unexpected responseCode: ${responseCode}`,
                responsePayload: (resultPayload as Record<string, unknown>) ?? null,
            });

            res.status(502).json({
                success: false,
                message: `Netvalve returned unexpected responseCode: ${responseCode}`,
                result: resultPayload,
            });
            return;
        }

        // success: update payment request and order with gateway response
        const paymentUrl = resultPayload && typeof resultPayload === 'object' && 'redirectUrl' in resultPayload ? (resultPayload as any).redirectUrl : undefined;
        const externalOrderId = resultPayload && typeof resultPayload === 'object' && 'orderId' in resultPayload ? (resultPayload as any).orderId : undefined;

        try {
            await paymentRequestCtr.updatePaymentRequest(context, {
                filter: { _id: paymentRequest._id ?? paymentRequest.id },
                update: {
                    $set: {
                        status: paymentUrl ? E_PaymentRequestStatus.PENDING : E_PaymentRequestStatus.FAILED,
                        paymentUrl: paymentUrl ?? null,
                        externalOrderId: externalOrderId ?? null,
                        gatewayResponse: resultPayload ?? null,
                        attempts: (paymentRequest.attempts ?? 0) + 1,
                    },
                },
            });

            await orderCtr.updateOrder(context, {
                filter: { _id: createdOrder?._id ?? createdOrder?.id },
                update: {
                    $set: {
                        externalOrderId: externalOrderId ?? null,
                        status: paymentUrl ? 'PENDING' : 'FAILED',
                    },
                },
            });

            // record success gateway transaction
            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: E_PaymentGatewayOperation.HPP_ORDER,
                transactionId: undefined,
                orderId: String(createdOrder?.id),
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: paymentUrl ? E_PaymentStatus.PENDING : E_PaymentStatus.FAILED,
                success: true,
                responsePayload: (resultPayload as Record<string, unknown>) ?? null,
            });
        }
        catch (err) {
            // non-fatal: still return result but record failure
            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: E_PaymentGatewayOperation.HPP_ORDER,
                transactionId: undefined,
                orderId: String(createdOrder?.id),
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: E_PaymentStatus.FAILED,
                success: false,
                errorMessage: err instanceof Error ? err.message : 'Failed to update payment records',
                responsePayload: (resultPayload as Record<string, unknown>) ?? null,
            });
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: resultPayload,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/sale', async (req, res, next) => {
    try {
        const {
            token,
            amount,
            currency,
            siteId,
            netvalveMidId,
            paymentType,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const resolvedToken = typeof token === 'string' ? token.trim() : '';
        if (!resolvedToken) {
            errors.push('token is required');
        }

        const resolvedAmount
            = typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            errors.push('amount must be a positive number');
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
        if (!resolvedCurrency) {
            errors.push('currency is required');
        }

        const resolvedPaymentTypeRaw = typeof paymentType === 'string' ? paymentType.trim().toUpperCase() : '';
        let resolvedPaymentType: E_NetvalvePaymentType | undefined;
        if (!resolvedPaymentTypeRaw) {
            errors.push('paymentType is required');
        }
        else if (!isNetvalvePaymentType(resolvedPaymentTypeRaw)) {
            errors.push(`paymentType must be one of: ${NETVALVE_PAYMENT_TYPES.join(', ')}`);
        }
        else {
            resolvedPaymentType = resolvedPaymentTypeRaw;
        }

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        if (!resolvedPaymentType) {
            res.status(400).json({ success: false, message: 'paymentType is invalid' });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveSalePayload = {
            ...normalizedPayload,
            token: resolvedToken,
            amount: resolvedAmount,
            currency: resolvedCurrency,
            paymentType: resolvedPaymentType,
        };

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.sale(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve sale failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/refund', async (req, res, next) => {
    try {
        const {
            transactionID,
            amount,
            currency,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const rawTransactionId = typeof transactionID === 'number'
            ? String(transactionID)
            : typeof transactionID === 'string'
                ? transactionID.trim()
                : '';
        if (!rawTransactionId) {
            errors.push('transactionID is required');
        }

        const resolvedAmount = amount === undefined || amount === null
            ? undefined
            : typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;
        if (resolvedAmount !== undefined) {
            if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
                errors.push('amount must be a positive number when provided');
            }
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveRefundPayload = {
            ...normalizedPayload,
            transactionID: rawTransactionId,
        };

        if (resolvedAmount !== undefined) {
            payload.amount = resolvedAmount;
        }

        if (resolvedCurrency) {
            payload.currency = resolvedCurrency;
        }

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.refund(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve refund failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/rebill', async (req, res, next) => {
    try {
        const {
            transactionID,
            amount,
            clientOrderId,
            currency,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const rawTransactionId = typeof transactionID === 'number'
            ? String(transactionID)
            : typeof transactionID === 'string'
                ? transactionID.trim()
                : '';
        if (!rawTransactionId) {
            errors.push('transactionID is required');
        }

        const resolvedAmount
            = typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            errors.push('amount must be a positive number');
        }

        const resolvedClientOrderId = typeof clientOrderId === 'string' ? clientOrderId.trim() : '';
        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveRebillPayload = {
            ...normalizedPayload,
            transactionID: rawTransactionId,
            amount: resolvedAmount,
        };

        if (resolvedClientOrderId) {
            payload.clientOrderId = resolvedClientOrderId;
        }

        if (resolvedCurrency) {
            payload.currency = resolvedCurrency;
        }

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.rebill(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve rebill failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/token/create', async (req, res, next) => {
    try {
        const {
            paymentType,
            currency,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const resolvedPaymentTypeRaw = typeof paymentType === 'string' ? paymentType.trim().toUpperCase() : '';
        let resolvedPaymentType: E_NetvalvePaymentType | undefined;
        if (!resolvedPaymentTypeRaw) {
            errors.push('paymentType is required');
        }
        else if (!isNetvalvePaymentType(resolvedPaymentTypeRaw)) {
            errors.push(`paymentType must be one of: ${NETVALVE_PAYMENT_TYPES.join(', ')}`);
        }
        else {
            resolvedPaymentType = resolvedPaymentTypeRaw;
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';

        if (errors.length > 0 || !resolvedPaymentType) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveCreateTokenPayload = {
            ...normalizedPayload,
            paymentType: resolvedPaymentType,
        };

        if (resolvedCurrency) {
            payload.currency = resolvedCurrency;
        }

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.createToken(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve token creation failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/capture', async (req, res, next) => {
    try {
        const {
            transactionID,
            amount,
            currency,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const rawTransactionId = typeof transactionID === 'number'
            ? String(transactionID)
            : typeof transactionID === 'string'
                ? transactionID.trim()
                : '';
        if (!rawTransactionId) {
            errors.push('transactionID is required');
        }

        const resolvedAmount = amount === undefined || amount === null
            ? undefined
            : typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;
        if (resolvedAmount !== undefined && (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0)) {
            errors.push('amount must be a positive number when provided');
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveCapturePayload = {
            ...normalizedPayload,
            transactionID: rawTransactionId,
        };

        if (resolvedAmount !== undefined) {
            payload.amount = resolvedAmount;
        }

        if (resolvedCurrency) {
            payload.currency = resolvedCurrency;
        }

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.capture(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve capture failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/cancel', async (req, res, next) => {
    try {
        const {
            transactionID,
            currency,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const rawTransactionId = typeof transactionID === 'number'
            ? String(transactionID)
            : typeof transactionID === 'string'
                ? transactionID.trim()
                : '';
        if (!rawTransactionId) {
            errors.push('transactionID is required');
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveCancelPayload = {
            ...normalizedPayload,
            transactionID: rawTransactionId,
        };

        if (resolvedCurrency) {
            payload.currency = resolvedCurrency;
        }

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.cancel(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve cancel failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/authorize', async (req, res, next) => {
    try {
        const {
            amount,
            currency,
            paymentType,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const resolvedAmount
            = typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            errors.push('amount must be a positive number');
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
        if (!resolvedCurrency) {
            errors.push('currency is required');
        }

        const resolvedPaymentTypeRaw = typeof paymentType === 'string' ? paymentType.trim().toUpperCase() : '';
        let resolvedPaymentType: E_NetvalvePaymentType | undefined;
        if (!resolvedPaymentTypeRaw) {
            errors.push('paymentType is required');
        }
        else if (!isNetvalvePaymentType(resolvedPaymentTypeRaw)) {
            errors.push(`paymentType must be one of: ${NETVALVE_PAYMENT_TYPES.join(', ')}`);
        }
        else {
            resolvedPaymentType = resolvedPaymentTypeRaw;
        }

        if (errors.length > 0 || !resolvedPaymentType) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_NetvalveAuthorizePayload = {
            ...normalizedPayload,
            amount: resolvedAmount,
            currency: resolvedCurrency,
            paymentType: resolvedPaymentType,
        };

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.authorize(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve authorize failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/3ds/initialization', async (req, res, next) => {
    try {
        const {
            amount,
            currency,
            cardNumber,
            cardExpireMonth,
            cardExpireYear,
            cardHolderName,
            merchantRedirectUrl,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const resolvedAmount
            = typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            errors.push('amount must be a positive number');
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
        if (!resolvedCurrency) {
            errors.push('currency is required');
        }

        const resolvedCardNumber = typeof cardNumber === 'string' ? cardNumber.trim() : '';
        if (!resolvedCardNumber) {
            errors.push('cardNumber is required');
        }

        const resolvedExpireMonth = typeof cardExpireMonth === 'string' ? cardExpireMonth.trim() : '';
        if (!resolvedExpireMonth) {
            errors.push('cardExpireMonth is required');
        }

        const resolvedExpireYear = typeof cardExpireYear === 'string' ? cardExpireYear.trim() : '';
        if (!resolvedExpireYear) {
            errors.push('cardExpireYear is required');
        }

        const resolvedHolderName = typeof cardHolderName === 'string' ? cardHolderName.trim() : '';
        if (!resolvedHolderName) {
            errors.push('cardHolderName is required');
        }

        const resolvedRedirectUrl = typeof merchantRedirectUrl === 'string' ? merchantRedirectUrl.trim() : '';
        if (!resolvedRedirectUrl) {
            errors.push('merchantRedirectUrl is required');
        }

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_Netvalve3DSInitializationPayload = {
            ...normalizedPayload,
            amount: resolvedAmount,
            currency: resolvedCurrency,
            cardNumber: resolvedCardNumber,
            cardExpireMonth: resolvedExpireMonth,
            cardExpireYear: resolvedExpireYear,
            cardHolderName: resolvedHolderName,
            merchantRedirectUrl: resolvedRedirectUrl,
        };

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.initialize3ds(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve 3DS initialization failed',
                result: failureResult,
            });
            return;
        }

        const initializationResult = response.result as I_Netvalve3DSInitializationResponse | undefined;
        const providerPayload = initializationResult?.threeDSProviderResponse as I_Netvalve3DSProviderResponse | undefined;
        const { flow, context: flowContext } = resolveThreeDSFlow(providerPayload);
        const normalizedResult = initializationResult
            ? { ...initializationResult, flow, flowContext }
            : { flow, flowContext };

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: normalizedResult,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/3ds/authentication', async (req, res, next) => {
    try {
        const {
            amount,
            currency,
            transID,
            siteId,
            netvalveMidId,
            ...restPayload
        } = req.body ?? {};

        const errors: string[] = [];

        const resolvedTransId = typeof transID === 'string' ? transID.trim() : '';
        mainRouter.get('/payment/netvalve/transaction', async (req, res, next) => {
            try {
                const query = req.query as Record<string, unknown>;
                const errors: string[] = [];

                const rawIdInput = query['id'];
                const sourceId = Array.isArray(rawIdInput) ? rawIdInput[0] : rawIdInput;
                const resolvedId = typeof sourceId === 'string' ? sourceId.trim() : typeof sourceId === 'number' ? String(sourceId) : '';
                if (!resolvedId) {
                    errors.push('id is required');
                }

                const collectBillingInfo = normalizeBooleanQuery(query['collectBillingInfo'], 'collectBillingInfo', errors);
                const collectShippingInfo = normalizeBooleanQuery(query['collectShippingInfo'], 'collectShippingInfo', errors);

                if (errors.length > 0) {
                    res.status(400).json({ success: false, message: errors.join(', ') });
                    return;
                }

                const payload: I_NetvalveGetTransactionQuery = {
                    id: resolvedId,
                };

                if (collectBillingInfo !== undefined) {
                    payload.collectBillingInfo = collectBillingInfo;
                }

                if (collectShippingInfo !== undefined) {
                    payload.collectShippingInfo = collectShippingInfo;
                }

                const context: I_Context = { req };
                const response = await netvalveCtr.getTransaction(context, payload);

                if (!response.success) {
                    const statusCode = typeof response.code === 'number' ? response.code : 502;
                    const failureResult = 'result' in response ? response.result : null;

                    res.status(statusCode).json({
                        success: false,
                        message: response.message ?? 'Netvalve get transaction failed',
                        result: failureResult,
                    });
                    return;
                }

                res.status(200).json({
                    success: true,
                    message: response.message ?? null,
                    result: response.result ?? null,
                });
            }
            catch (error) {
                next(error);
            }
        });

        mainRouter.get('/payment/netvalve/orders', async (req, res, next) => {
            try {
                const query = req.query as Record<string, unknown>;
                const errors: string[] = [];

                const filters = normalizeFiltersQuery(query['filters'], 'filters', errors);
                const page = normalizePositiveNumber(query['page'], 'page', errors, { required: true });
                const pageSize = normalizePositiveNumber(query['pageSize'], 'pageSize', errors, { required: true });

                if (errors.length > 0 || page === undefined || pageSize === undefined || !filters) {
                    if (!filters && !errors.includes('filters must be a JSON object') && !errors.includes('filters must be a valid JSON object')) {
                        errors.push('filters are required');
                    }

                    res.status(400).json({ success: false, message: errors.join(', ') });
                    return;
                }

                const payload: I_NetvalveGetOrdersQuery = {
                    filters,
                    page,
                    pageSize,
                };

                const context: I_Context = { req };
                const response = await netvalveCtr.getOrders(context, payload);

                if (!response.success) {
                    const statusCode = typeof response.code === 'number' ? response.code : 502;
                    const failureResult = 'result' in response ? response.result : null;

                    res.status(statusCode).json({
                        success: false,
                        message: response.message ?? 'Netvalve get orders failed',
                        result: failureResult,
                    });
                    return;
                }

                res.status(200).json({
                    success: true,
                    message: response.message ?? null,
                    result: response.result ?? null,
                });
            }
            catch (error) {
                next(error);
            }
        });

        mainRouter.get('/payment/netvalve/order', async (req, res, next) => {
            try {
                const query = req.query as Record<string, unknown>;
                const errors: string[] = [];

                const normalizeString = (value: unknown): string => {
                    const source = Array.isArray(value) ? value[0] : value;
                    return typeof source === 'string' ? source.trim() : typeof source === 'number' ? String(source) : '';
                };

                const id = normalizeString(query['id']);
                const clientOrderId = normalizeString(query['clientOrderId']);
                const netvalveMidId = normalizeString(query['netvalveMidId']);
                const transactionId = normalizeString(query['transactionId']);

                if (!id && !clientOrderId && !netvalveMidId && !transactionId) {
                    errors.push('Provide at least one identifier: id, clientOrderId, netvalveMidId, or transactionId');
                }

                const collectBillingInfo = normalizeBooleanQuery(query['collectBillingInfo'], 'collectBillingInfo', errors);
                const collectShippingInfo = normalizeBooleanQuery(query['collectShippingInfo'], 'collectShippingInfo', errors);

                if (errors.length > 0) {
                    res.status(400).json({ success: false, message: errors.join(', ') });
                    return;
                }

                const payload: I_NetvalveGetOrderQuery = {};

                if (id) {
                    payload.id = id;
                }
                if (clientOrderId) {
                    payload.clientOrderId = clientOrderId;
                }
                if (netvalveMidId) {
                    payload.netvalveMidId = netvalveMidId;
                }
                if (transactionId) {
                    payload.transactionId = transactionId;
                }
                if (collectBillingInfo !== undefined) {
                    payload.collectBillingInfo = collectBillingInfo;
                }
                if (collectShippingInfo !== undefined) {
                    payload.collectShippingInfo = collectShippingInfo;
                }

                const context: I_Context = { req };
                const response = await netvalveCtr.getOrder(context, payload);

                if (!response.success) {
                    const statusCode = typeof response.code === 'number' ? response.code : 502;
                    const failureResult = 'result' in response ? response.result : null;

                    res.status(statusCode).json({
                        success: false,
                        message: response.message ?? 'Netvalve get order failed',
                        result: failureResult,
                    });
                    return;
                }

                res.status(200).json({
                    success: true,
                    message: response.message ?? null,
                    result: response.result ?? null,
                });
            }
            catch (error) {
                next(error);
            }
        });

        mainRouter.get('/payment/netvalve/transaction/status', async (req, res, next) => {
            try {
                const query = req.query as Record<string, unknown>;
                const errors: string[] = [];

                const rawTransactionIdInput = query['transactionId'];
                const sourceTransactionId = Array.isArray(rawTransactionIdInput) ? rawTransactionIdInput[0] : rawTransactionIdInput;
                const transactionId = typeof sourceTransactionId === 'string'
                    ? sourceTransactionId.trim()
                    : typeof sourceTransactionId === 'number'
                        ? String(sourceTransactionId)
                        : '';

                if (!transactionId) {
                    errors.push('transactionId is required');
                }

                if (errors.length > 0) {
                    res.status(400).json({ success: false, message: errors.join(', ') });
                    return;
                }

                const payload: I_NetvalveQueryTransactionStatusQuery = {
                    transactionId,
                };

                const context: I_Context = { req };
                const response = await netvalveCtr.queryTransactionStatus(context, payload);

                if (!response.success) {
                    const statusCode = typeof response.code === 'number' ? response.code : 502;
                    const failureResult = 'result' in response ? response.result : null;

                    res.status(statusCode).json({
                        success: false,
                        message: response.message ?? 'Netvalve transaction status query failed',
                        result: failureResult,
                    });
                    return;
                }

                res.status(200).json({
                    success: true,
                    message: response.message ?? null,
                    result: response.result ?? null,
                });
            }
            catch (error) {
                next(error);
            }
        });

        mainRouter.get('/payment/netvalve/transactions', async (req, res, next) => {
            try {
                const query = req.query as Record<string, unknown>;
                const errors: string[] = [];

                const filters = normalizeFiltersQuery(query['filters'], 'filters', errors);
                const page = normalizePositiveNumber(query['page'], 'page', errors, { required: true });
                const pageSize = normalizePositiveNumber(query['pageSize'], 'pageSize', errors, { required: true });

                if (errors.length > 0 || page === undefined || pageSize === undefined || !filters) {
                    if (!filters && !errors.includes('filters must be a JSON object') && !errors.includes('filters must be a valid JSON object')) {
                        errors.push('filters are required');
                    }

                    res.status(400).json({ success: false, message: errors.join(', ') });
                    return;
                }

                const payload: I_NetvalveGetTransactionsQuery = {
                    filters,
                    page,
                    pageSize,
                };

                const context: I_Context = { req };
                const response = await netvalveCtr.getTransactions(context, payload);

                if (!response.success) {
                    const statusCode = typeof response.code === 'number' ? response.code : 502;
                    const failureResult = 'result' in response ? response.result : null;

                    res.status(statusCode).json({
                        success: false,
                        message: response.message ?? 'Netvalve get transactions failed',
                        result: failureResult,
                    });
                    return;
                }

                res.status(200).json({
                    success: true,
                    message: response.message ?? null,
                    result: response.result ?? null,
                });
            }
            catch (error) {
                next(error);
            }
        });
        if (!resolvedTransId) {
            errors.push('transID is required');
        }

        const resolvedAmount
            = typeof amount === 'number'
                ? amount
                : typeof amount === 'string'
                    ? Number(amount)
                    : Number.NaN;
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            errors.push('amount must be a positive number');
        }

        const resolvedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
        if (!resolvedCurrency) {
            errors.push('currency is required');
        }

        if (errors.length > 0) {
            res.status(400).json({ success: false, message: errors.join(', ') });
            return;
        }

        const normalizedPayload: Record<string, unknown> = { ...restPayload };

        const payload: I_Netvalve3DSAuthenticationPayload = {
            ...normalizedPayload,
            transID: resolvedTransId,
            amount: resolvedAmount,
            currency: resolvedCurrency,
        };

        if (typeof siteId === 'string' && siteId.trim()) {
            payload.siteId = siteId.trim();
        }

        if (typeof netvalveMidId === 'string' && netvalveMidId.trim()) {
            payload.netvalveMidId = netvalveMidId.trim();
        }

        const context: I_Context = { req };
        const response = await netvalveCtr.authenticate3ds(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve 3DS authentication failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

mainRouter.post('/payment/netvalve/3ds/result', async (req, res, next) => {
    try {
        const { transID, ...restPayload } = req.body ?? {};

        const resolvedTransId = typeof transID === 'string' ? transID.trim() : '';
        if (!resolvedTransId) {
            res.status(400).json({ success: false, message: 'transID is required' });
            return;
        }

        const payload: I_Netvalve3DSResultPayload = {
            ...restPayload,
            transID: resolvedTransId,
        };

        const context: I_Context = { req };
        const response = await netvalveCtr.result3ds(context, payload);

        if (!response.success) {
            const statusCode = typeof response.code === 'number' ? response.code : 502;
            const failureResult = 'result' in response ? response.result : null;

            res.status(statusCode).json({
                success: false,
                message: response.message ?? 'Netvalve 3DS result failed',
                result: failureResult,
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: response.message ?? null,
            result: response.result ?? null,
        });
    }
    catch (error) {
        next(error);
    }
});

// Mount payment router
mainRouter.use(paymentRouter);

export { mainRouter };
