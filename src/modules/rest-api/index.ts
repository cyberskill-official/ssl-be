import { express, Router } from '@cyberskill/shared/node/express';
import { log } from '@cyberskill/shared/node/log';
import { addHours } from 'date-fns';

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

import { roleCtr } from '#modules/authz/index.js';
import { E_Role_User } from '#modules/authz/role/role.type.js';
import orderCtr from '#modules/order/order.controller.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus, E_OrderType } from '#modules/order/order.type.js';
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
import { calculateAmountFromPricing, pricingCtr } from '#modules/pricing/index.js';
import { userCtr } from '#modules/user/index.js';
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
        // Calculate amount (price + tax) from pricing
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            try {
                const context: I_Context = { req };
                // getSubscriptionPrice returns price and taxRate, calculate amount with tax
                const priceRes = await pricingCtr.getSubscriptionPrice(context);
                if (priceRes.success && priceRes.result) {
                    // Calculate amount from price and taxRate
                    const basePrice = priceRes.result.price ?? 0;
                    const taxRate = priceRes.result.taxRate ?? 0;
                    const taxPortion = basePrice * (taxRate / 100);
                    resolvedAmount = Number((basePrice + taxPortion).toFixed(2));
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

        const context: I_Context = { req };

        const orderDoc: Record<string, unknown> = {
            amount: resolvedAmount,
            currency: resolvedCurrency,
            successUrl: resolvedSuccessUrl,
            cancelUrl: resolvedCancelUrl,
            pendingUrl: resolvedPendingUrl,
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
        if (!createdOrder || !createdOrder.id) {
            res.status(500).json({ success: false, message: 'Failed to create order: order ID missing' });
            return;
        }

        const payload: I_NetvalveHppOrderPayload = {
            ...normalizedPayload,
            amount: resolvedAmount,
            currency: resolvedCurrency,
            clientOrderId: createdOrder.id, // Always use order.id
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

        // 2) idempotent PaymentRequest: try reuse WAITING by checking meta.orderId
        // For now, create new PaymentRequest each time (idempotency handled by Order)
        const prDoc: Record<string, unknown> = {
            gateway: 'NETVALVE',
            status: E_PaymentRequestStatus.WAITING,
            attempts: 0,
            meta: {
                orderId: createdOrder.id,
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
            },
        };

        const paymentRequestResult = await paymentRequestCtr.createPaymentRequest(context, { doc: prDoc });

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
                const netvalveMidId = normalizeString(query['netvalveMidId']);
                const transactionId = normalizeString(query['transactionId']);

                if (!id && !netvalveMidId && !transactionId) {
                    errors.push('Provide at least one identifier: id, netvalveMidId, or transactionId');
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

// Test endpoint to setup rebill test data
// POST /test/rebill/setup
// Body: { userId?: string, username?: string, hoursUntilExpiry?: number } (optional - will create new user if not provided)
mainRouter.post('/test/rebill/setup', async (req, res, next) => {
    try {
        const { userId, username, hoursUntilExpiry = 12 } = req.body ?? {};
        const context: I_Context = { req };

        // Get PAID_MEMBER role
        const paidRoleRes = await roleCtr.getRole(context, { filter: { name: E_Role_User.PAID_MEMBER } });
        if (!paidRoleRes.success || !paidRoleRes.result) {
            res.status(500).json({ success: false, message: 'PAID_MEMBER role not found' });
            return;
        }
        const paidRoleId = paidRoleRes.result.id;

        let user;
        let testUserId = userId;

        if (testUserId || username) {
            // Find user by userId or username
            let userRes;
            if (testUserId) {
                userRes = await userCtr.getUser(context, { filter: { id: testUserId } });
            }
            else if (username) {
                userRes = await userCtr.getUser(context, { filter: { username } });
            }

            if (!userRes || !userRes.success || !userRes.result) {
                res.status(404).json({
                    success: false,
                    message: `User not found${username ? ` with username: ${username}` : ` with userId: ${testUserId}`}`,
                });
                return;
            }
            user = userRes.result;
            testUserId = user.id;

            // Update user to have PAID_MEMBER role and membership expiring soon
            const expiryDate = addHours(new Date(), hoursUntilExpiry);
            const updateRes = await userCtr.updateUser(context, {
                filter: { id: testUserId },
                update: {
                    rolesIds: [paidRoleId],
                    membershipExpiresAt: expiryDate,
                    membershipCancelled: false,
                },
            });

            if (!updateRes.success || !updateRes.result) {
                res.status(500).json({ success: false, message: 'Failed to update user', error: updateRes.message });
                return;
            }
            user = updateRes.result;
        }
        else {
            // Create new test user
            const testEmail = `test-rebill-${Date.now()}@test.com`;
            const testUsername = `test-rebill-${Date.now()}`;
            const expiryDate = addHours(new Date(), hoursUntilExpiry);

            const createRes = await userCtr.createUser(context, {
                doc: {
                    username: testUsername,
                    email: testEmail,
                    password: 'Test123!@#',
                    rolesIds: [paidRoleId],
                    registerStep: 'COMPLETE' as any,
                    isEmailVerified: true,
                    membershipExpiresAt: expiryDate,
                    membershipCancelled: false,
                },
            });

            if (!createRes.success || !createRes.result) {
                res.status(500).json({ success: false, message: 'Failed to create test user', error: createRes.message });
                return;
            }
            user = createRes.result;
            testUserId = user.id;
        }

        // Get pricing for subscription - use real pricing from database
        const pricingRes = await pricingCtr.getPricings(context, {
            filter: {
                type: 'MEMBERSHIP' as any,
                isActive: true, // Only get active pricing
            },
            options: {
                pagination: false,
                limit: 1,
                populate: [{ path: 'currency' }], // Populate currency for accurate amount
            },
        });

        if (!pricingRes.success || !pricingRes.result?.docs?.[0]) {
            res.status(500).json({
                success: false,
                message: 'No active MEMBERSHIP pricing found. Please create a pricing in the database first.',
            });
            return;
        }

        const pricing = pricingRes.result.docs[0];
        const pricingId = pricing.id;

        // Calculate amount from pricing (price + tax)
        const amount = calculateAmountFromPricing(pricing);

        if (!Number.isFinite(amount) || amount <= 0) {
            res.status(500).json({
                success: false,
                message: 'Pricing has no amount or price field. Please check pricing configuration.',
            });
            return;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            res.status(500).json({
                success: false,
                message: `Invalid pricing amount: ${amount}. Please check pricing configuration.`,
            });
            return;
        }

        log.info(`[TEST] Using real pricing: pricingId=${pricingId}, amount=${amount}, price=${(pricing as any).price}, taxRate=${(pricing as any).taxRate}`);

        // Create a test payment transaction (simulating a successful payment)
        // NetValve requires transactionID to be a number (Long), so we use timestamp as numeric ID
        const testTransactionId = String(Date.now()); // Use timestamp as numeric transaction ID
        const paymentTransactionRes = await paymentCtr.recordGatewayTransaction(context, {
            provider: E_PaymentProvider.NETVALVE,
            operation: E_PaymentGatewayOperation.SALE,
            transactionId: testTransactionId,
            status: E_PaymentStatus.SUCCESS,
            success: true,
            responsePayload: { test: true },
            performedAt: new Date(),
        });

        if (!paymentTransactionRes.success || !paymentTransactionRes.result) {
            res.status(500).json({
                success: false,
                message: 'Failed to create payment transaction',
                error: paymentTransactionRes.message,
            });
            return;
        }

        // Create a test order (PAID status) - this simulates the initial payment
        const orderRes = await orderCtr.createOrder(context, {
            doc: {
                userId: testUserId,
                amount,
                pricingId,
                orderType: E_OrderType.SUBSCRIPTION,
                paymentTransactionId: paymentTransactionRes.result.id,
                status: E_OrderStatus.PAID,
            },
        });

        if (!orderRes.success || !orderRes.result) {
            res.status(500).json({
                success: false,
                message: 'Failed to create test order',
                error: orderRes.message,
            });
            return;
        }

        log.info(`[TEST] Rebill test data created: userId=${testUserId}, membershipExpiresAt=${user.membershipExpiresAt}, orderId=${orderRes.result.id}`);

        res.status(200).json({
            success: true,
            message: 'Rebill test data created successfully',
            result: {
                userId: testUserId,
                userEmail: user.email,
                username: user.username,
                membershipExpiresAt: user.membershipExpiresAt,
                membershipCancelled: user.membershipCancelled,
                orderId: orderRes.result.id,
                transactionId: testTransactionId,
                hoursUntilExpiry,
                note: `Cron job will rebill this user when membership expires within 24 hours (currently ${hoursUntilExpiry} hours away)`,
            },
        });
    }
    catch (error) {
        log.error('[TEST] Error setting up rebill test data:', error);
        next(error);
    }
});

// Test endpoint to convert PENDING order to PAID for rebill testing
// POST /test/rebill/convert-order
// Body: { orderId: string } - converts a PENDING order to PAID with SALE transaction
mainRouter.post('/test/rebill/convert-order', async (req, res, next) => {
    try {
        const { orderId } = req.body ?? {};
        if (!orderId || typeof orderId !== 'string') {
            res.status(400).json({ success: false, message: 'orderId is required' });
            return;
        }

        const context: I_Context = { req };

        // Get the order
        const orderRes = await orderCtr.getOrder(context, {
            filter: { id: orderId },
            populate: [{ path: 'pricing', populate: ['currency'] }],
        });

        if (!orderRes.success || !orderRes.result) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }

        const order = orderRes.result;

        // Check if order is already PAID
        if (order.status === E_OrderStatus.PAID) {
            res.status(200).json({
                success: true,
                message: 'Order is already PAID',
                result: {
                    orderId: order.id,
                    status: order.status,
                    paymentTransactionId: order.paymentTransactionId,
                    note: 'Order is already in PAID status, no conversion needed',
                },
            });
            return;
        }

        // Try to find existing PaymentTransaction for this order
        let existingPaymentTransaction = null;
        let transactionId: string | undefined;

        // Method 1: Check if order already has paymentTransactionId
        if (order.paymentTransactionId) {
            const existingPtRes = await paymentCtr.getPaymentTransaction(context, {
                filter: { id: order.paymentTransactionId },
            });
            if (existingPtRes.success && existingPtRes.result) {
                existingPaymentTransaction = existingPtRes.result;
                transactionId = existingPaymentTransaction.transactionId;
                log.info(`[TEST] Found existing PaymentTransaction via order.paymentTransactionId: ${existingPaymentTransaction.id}`);
            }
        }

        // Method 2: Try to find via paymentRequestId -> PaymentRequest -> transactionID
        if (!existingPaymentTransaction && order.paymentRequestId) {
            const paymentRequestRes = await paymentRequestCtr.getPaymentRequest(context, {
                filter: { id: order.paymentRequestId },
            });

            if (paymentRequestRes.success && paymentRequestRes.result) {
                const paymentRequest = paymentRequestRes.result;
                // Try externalOrderId first (NetValve orderId)
                const externalOrderId = paymentRequest.externalOrderId;
                if (externalOrderId) {
                    // Find PaymentTransaction with this transactionId, regardless of operation
                    // This will find HPP_ORDER transaction created during order creation
                    const ptRes = await paymentCtr.getPaymentTransaction(context, {
                        filter: { transactionId: externalOrderId, provider: E_PaymentProvider.NETVALVE },
                    });
                    if (ptRes.success && ptRes.result) {
                        existingPaymentTransaction = ptRes.result;
                        transactionId = existingPaymentTransaction.transactionId;
                        log.info(`[TEST] Found existing PaymentTransaction via PaymentRequest.externalOrderId: ${existingPaymentTransaction.id}, operation: ${existingPaymentTransaction.operation}, status: ${existingPaymentTransaction.status}`);
                    }
                }

                // Try gatewayResponse.transactionID if not found
                if (!existingPaymentTransaction && paymentRequest.gatewayResponse) {
                    const gatewayResponse = paymentRequest.gatewayResponse as Record<string, unknown>;
                    const gatewayTransactionId = gatewayResponse['transactionID'] || gatewayResponse['transactionId'];
                    if (gatewayTransactionId && typeof gatewayTransactionId === 'string') {
                        const ptRes = await paymentCtr.getPaymentTransaction(context, {
                            filter: { transactionId: gatewayTransactionId, provider: E_PaymentProvider.NETVALVE },
                        });
                        if (ptRes.success && ptRes.result) {
                            existingPaymentTransaction = ptRes.result;
                            transactionId = existingPaymentTransaction.transactionId;
                            log.info(`[TEST] Found existing PaymentTransaction via PaymentRequest.gatewayResponse.transactionID: ${existingPaymentTransaction.id}, operation: ${existingPaymentTransaction.operation}, status: ${existingPaymentTransaction.status}`);
                        }
                    }
                }
            }
        }

        // Method 3: Try to find any PaymentTransaction related to this order via orderId in PaymentRequest
        // This is a fallback to find HPP_ORDER transactions that might have been created
        if (!existingPaymentTransaction) {
            // Find PaymentRequest by orderId in meta
            const paymentRequestsRes = await paymentRequestCtr.getPaymentRequests(context, {
                filter: { 'meta.orderId': order.id },
                options: { pagination: false, sort: { createdAt: -1 }, limit: 1 },
            });

            if (paymentRequestsRes.success && paymentRequestsRes.result?.docs?.length) {
                const paymentRequest = paymentRequestsRes.result.docs[0];
                if (!paymentRequest) {
                    return;
                }
                const externalOrderId = paymentRequest.externalOrderId;
                if (externalOrderId) {
                    const ptRes = await paymentCtr.getPaymentTransaction(context, {
                        filter: { transactionId: externalOrderId, provider: E_PaymentProvider.NETVALVE },
                    });
                    if (ptRes.success && ptRes.result) {
                        existingPaymentTransaction = ptRes.result;
                        transactionId = existingPaymentTransaction.transactionId;
                        log.info(`[TEST] Found existing PaymentTransaction via PaymentRequest.meta.orderId: ${existingPaymentTransaction.id}, operation: ${existingPaymentTransaction.operation}, status: ${existingPaymentTransaction.status}`);
                    }
                }
            }
        }

        // Update existing PaymentTransaction to SUCCESS, or create new one
        let paymentTransactionRes;
        if (existingPaymentTransaction) {
            // Update existing transaction to SUCCESS
            // IMPORTANT: Use the SAME operation and transactionId to ensure it updates, not creates a new one
            const existingOperation = existingPaymentTransaction.operation || E_PaymentGatewayOperation.HPP_ORDER;
            const existingTransactionId = transactionId || existingPaymentTransaction.transactionId;

            if (!existingTransactionId) {
                log.warn(`[TEST] Existing PaymentTransaction ${existingPaymentTransaction.id} has no transactionId, creating new one instead`);
                // Set to null so it will create new one below
                paymentTransactionRes = { success: false } as any;
            }
            else {
                log.info(`[TEST] Updating existing PaymentTransaction ${existingPaymentTransaction.id} from ${existingPaymentTransaction.status} to SUCCESS (operation: ${existingOperation}, transactionId: ${existingTransactionId})`);
                paymentTransactionRes = await paymentCtr.recordGatewayTransaction(context, {
                    provider: E_PaymentProvider.NETVALVE,
                    operation: existingOperation, // Keep the same operation (HPP_ORDER) to ensure update, not create
                    transactionId: existingTransactionId, // Keep the same transactionId to ensure update
                    status: E_PaymentStatus.SUCCESS,
                    success: true,
                    responsePayload: {
                        ...(existingPaymentTransaction.responsePayload as Record<string, unknown> || {}),
                        status: 'SUCCESS',
                        test: true,
                        updatedAt: new Date().toISOString(),
                    },
                    performedAt: new Date(),
                });
            }
        }

        // If update failed or no existing transaction found, return error
        // We should NOT create/modify NetValve data - only update existing PaymentTransaction
        if (!existingPaymentTransaction || !paymentTransactionRes?.success) {
            res.status(400).json({
                success: false,
                message: 'Cannot convert order to PAID: No PaymentTransaction found from NetValve. Order must have a PaymentTransaction created by NetValve HPP flow.',
                error: 'PaymentTransaction is required to convert order to PAID. This endpoint only updates existing PaymentTransaction status, it does not create new ones.',
                orderId: order.id,
                note: 'To test rebill, use an order that was created through the normal payment flow (HPP), which will have a PaymentTransaction with NetValve transactionId.',
            });
            return;
        }

        if (!paymentTransactionRes.success || !paymentTransactionRes.result) {
            res.status(500).json({
                success: false,
                message: 'Failed to create/update payment transaction',
                error: paymentTransactionRes.message,
            });
            return;
        }

        // Update order to PAID status with paymentTransactionId
        const updateOrderRes = await orderCtr.updateOrder(context, {
            filter: { id: orderId },
            update: {
                status: E_OrderStatus.PAID,
                paymentTransactionId: paymentTransactionRes.result.id,
            },
        });

        if (!updateOrderRes.success || !updateOrderRes.result) {
            res.status(500).json({
                success: false,
                message: 'Failed to update order to PAID',
                error: updateOrderRes.message,
            });
            return;
        }

        // Apply order paid effects (extend membership, update roles, etc.)
        try {
            const paidOrder = updateOrderRes.result;
            await applyOrderPaidEffects(context, paidOrder);
            log.info(`[TEST] Applied order paid effects for order ${orderId}`);
        }
        catch (error) {
            log.error(`[TEST] Failed to apply order paid effects for order ${orderId}:`, error);
            // Continue even if effects fail, order is still PAID
        }

        const wasUpdated = existingPaymentTransaction !== null;
        const finalTransactionId = paymentTransactionRes.result.transactionId || transactionId || 'N/A';

        log.info(`[TEST] Converted order ${orderId} from ${order.status} to PAID. ${wasUpdated ? 'Updated' : 'Created'} PaymentTransaction ${paymentTransactionRes.result.id} with transactionId=${finalTransactionId}`);

        res.status(200).json({
            success: true,
            message: `Order converted to PAID successfully. ${wasUpdated ? 'Updated existing' : 'Created new'} PaymentTransaction.`,
            result: {
                orderId: order.id,
                previousStatus: order.status,
                newStatus: E_OrderStatus.PAID,
                paymentTransactionId: paymentTransactionRes.result.id,
                transactionId: finalTransactionId,
                wasUpdated,
                note: 'This order can now be used for rebill testing. Make sure user has membershipExpiresAt within 24 hours.',
            },
        });
    }
    catch (error) {
        log.error('[TEST] Error converting order:', error);
        next(error);
    }
});

// Test endpoint to set membershipExpiresAt within 24h for rebill testing
// POST /test/rebill/set-expiry
// Body: { orderId: string, hoursUntilExpiry?: number } - sets membershipExpiresAt for user of this order
mainRouter.post('/test/rebill/set-expiry', async (req, res, next) => {
    try {
        const { orderId, hoursUntilExpiry = 12 } = req.body ?? {};
        if (!orderId || typeof orderId !== 'string') {
            res.status(400).json({ success: false, message: 'orderId is required' });
            return;
        }

        const context: I_Context = { req };

        // Get the order
        const orderRes = await orderCtr.getOrder(context, {
            filter: { id: orderId },
        });

        if (!orderRes.success || !orderRes.result) {
            res.status(404).json({ success: false, message: 'Order not found' });
            return;
        }

        const order = orderRes.result;
        if (!order.userId) {
            res.status(400).json({ success: false, message: 'Order has no userId' });
            return;
        }

        // Set membershipExpiresAt within 24h
        const expiryDate = addHours(new Date(), hoursUntilExpiry);

        const updateRes = await userCtr.updateUser(context, {
            filter: { id: order.userId },
            update: {
                membershipExpiresAt: expiryDate,
            },
        });

        if (!updateRes.success || !updateRes.result) {
            res.status(500).json({
                success: false,
                message: 'Failed to update membershipExpiresAt',
                error: updateRes.message,
            });
            return;
        }

        log.info(`[TEST] Set membershipExpiresAt for user ${order.userId} to ${expiryDate.toISOString()} (${hoursUntilExpiry} hours from now)`);

        res.status(200).json({
            success: true,
            message: 'Membership expiry set successfully',
            result: {
                userId: order.userId,
                membershipExpiresAt: expiryDate.toISOString(),
                hoursUntilExpiry,
                note: `User is now eligible for rebill. Cronjob will process within 24h.`,
            },
        });
    }
    catch (error) {
        log.error('[TEST] Error setting membership expiry:', error);
        next(error);
    }
});

// Test endpoint to cancel membership for any user
// POST /test/membership/cancel
// Body: { username?: string, userId?: string } - cancels membership for the specified user
mainRouter.post('/test/membership/cancel', async (req, res, next) => {
    try {
        const { username, userId } = req.body ?? {};
        if (!username && !userId) {
            res.status(400).json({ success: false, message: 'username or userId is required' });
            return;
        }

        const context: I_Context = { req };

        // Find user
        let userRes;
        if (userId) {
            userRes = await userCtr.getUser(context, { filter: { id: userId } });
        }
        else if (username) {
            userRes = await userCtr.getUser(context, { filter: { username } });
        }

        if (!userRes || !userRes.success || !userRes.result) {
            res.status(404).json({
                success: false,
                message: `User not found${username ? ` with username: ${username}` : ` with userId: ${userId}`}`,
            });
            return;
        }

        const user = userRes.result;

        // Check if user has active membership
        const isActive = user.membershipExpiresAt && new Date(user.membershipExpiresAt) > new Date();
        if (!isActive) {
            res.status(400).json({
                success: false,
                message: 'User does not have an active paid membership to cancel',
                membershipExpiresAt: user.membershipExpiresAt,
            });
            return;
        }

        // Try to cancel in NetValve (similar to cancelMembership)
        let netvalveCancelSuccess = false;
        try {
            const ordersRes = await orderCtr.getOrders(context, {
                filter: {
                    userId: user.id,
                    status: E_OrderStatus.PAID,
                    orderType: E_OrderType.SUBSCRIPTION,
                },
                options: {
                    pagination: false,
                    sort: { createdAt: -1 },
                    limit: 1,
                    populate: [{ path: 'paymentTransaction' }],
                },
            } as any);

            const lastOrder = ordersRes.success ? ordersRes.result?.docs?.[0] : null;
            let transactionId: string | undefined;

            if (lastOrder) {
                transactionId = (lastOrder as any)?.paymentTransaction?.transactionId;
                if (!transactionId && (lastOrder as any)?.paymentTransactionId) {
                    const ptRes = await paymentCtr.getPaymentTransaction(context, {
                        filter: { id: (lastOrder as any).paymentTransactionId },
                    } as any);
                    if (ptRes.success && ptRes.result?.transactionId) {
                        transactionId = ptRes.result.transactionId;
                    }
                }
            }

            if (transactionId) {
                const pricing = (lastOrder as any)?.pricing;
                const currency = pricing?.currency?.code || 'EUR';

                const cancelRes = await netvalveCtr.cancel(context, {
                    transactionID: String(transactionId),
                    currency,
                } as any);

                if (cancelRes.success) {
                    netvalveCancelSuccess = true;
                    log.info(`[TEST] NetValve cancel called successfully for user ${user.id}, transactionId=${transactionId}`);
                }
                else {
                    log.warn(`[TEST] NetValve cancel failed for user ${user.id}, transactionId=${transactionId}: ${cancelRes.message}`);
                }
            }
        }
        catch (error) {
            log.error(`[TEST] Error calling NetValve cancel for user ${user.id}:`, error);
        }

        // Set membershipCancelled = true
        const updateRes = await userCtr.updateUser(context, {
            filter: { id: user.id },
            update: {
                membershipCancelled: true,
            },
        });

        if (!updateRes.success || !updateRes.result) {
            res.status(500).json({
                success: false,
                message: 'Failed to cancel membership',
                error: updateRes.message,
            });
            return;
        }

        log.info(`[TEST] Membership cancelled for user ${user.id}. Access until ${user.membershipExpiresAt}. NetValve cancel: ${netvalveCancelSuccess ? 'success' : 'skipped/failed'}`);

        res.status(200).json({
            success: true,
            message: 'Membership cancelled successfully',
            result: {
                userId: user.id,
                username: user.username,
                email: user.email,
                membershipCancelled: true,
                membershipExpiresAt: user.membershipExpiresAt,
                netvalveCancelSuccess,
                note: 'User will keep access until membershipExpiresAt. Future rebills will be skipped.',
            },
        });
    }
    catch (error) {
        log.error('[TEST] Error cancelling membership:', error);
        next(error);
    }
});

// Test endpoint to set membershipExpiresAt for any user (for testing rebill after cancel)
// POST /test/membership/set-expiry
// Body: { username?: string, userId?: string, hoursUntilExpiry?: number } - sets membershipExpiresAt for the specified user
mainRouter.post('/test/membership/set-expiry', async (req, res, next) => {
    try {
        const { username, userId, hoursUntilExpiry = 12 } = req.body ?? {};
        if (!username && !userId) {
            res.status(400).json({ success: false, message: 'username or userId is required' });
            return;
        }

        const context: I_Context = { req };

        // Find user
        let userRes;
        if (userId) {
            userRes = await userCtr.getUser(context, { filter: { id: userId } });
        }
        else if (username) {
            userRes = await userCtr.getUser(context, { filter: { username } });
        }

        if (!userRes || !userRes.success || !userRes.result) {
            res.status(404).json({
                success: false,
                message: `User not found${username ? ` with username: ${username}` : ` with userId: ${userId}`}`,
            });
            return;
        }

        const user = userRes.result;

        // Set membershipExpiresAt within 24h
        const expiryDate = addHours(new Date(), hoursUntilExpiry);

        const updateRes = await userCtr.updateUser(context, {
            filter: { id: user.id },
            update: {
                membershipExpiresAt: expiryDate,
            },
        });

        if (!updateRes.success || !updateRes.result) {
            res.status(500).json({
                success: false,
                message: 'Failed to update membershipExpiresAt',
                error: updateRes.message,
            });
            return;
        }

        log.info(`[TEST] Set membershipExpiresAt for user ${user.id} to ${expiryDate.toISOString()} (${hoursUntilExpiry} hours from now). membershipCancelled: ${user.membershipCancelled}`);

        res.status(200).json({
            success: true,
            message: 'Membership expiry set successfully',
            result: {
                userId: user.id,
                username: user.username,
                membershipExpiresAt: expiryDate.toISOString(),
                membershipCancelled: user.membershipCancelled,
                hoursUntilExpiry,
                note: user.membershipCancelled
                    ? 'User has cancelled membership. Cronjob will skip rebill even if membershipExpiresAt is within 24h.'
                    : `User is now eligible for rebill. Cronjob will process within 24h.`,
            },
        });
    }
    catch (error) {
        log.error('[TEST] Error setting membership expiry:', error);
        next(error);
    }
});

export { mainRouter };
