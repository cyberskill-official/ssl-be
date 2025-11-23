import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';

import type { I_Order } from '#modules/order/order.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { orderCtr } from '#modules/order/index.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderPaymentPurpose, E_OrderStatus } from '#modules/order/order.type.js';
import { netvalveCtr } from '#modules/payment/netvalve/index.js';
import { E_NetvalvePaymentType } from '#modules/payment/netvalve/netvalve.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/index.js';
import { E_PaymentProvider, E_PaymentStatus } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { pricingCtr } from '#modules/pricing/index.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';

import type { I_Input_MakePayment, I_MakePaymentResult } from './payment.type.js';

import { E_MakePaymentResultStatus } from './payment.type.js';

export const paymentController = {
    async makePayment(context: I_Context, { input }: { input: I_Input_MakePayment }): Promise<I_Return<I_MakePaymentResult>> {
        const toStr = (v: unknown): string | undefined => typeof v === 'string' ? v.trim() : undefined;
        const toNum = (v: unknown): number | undefined => {
            if (typeof v === 'number')
                return v;
            if (typeof v === 'string' && v.trim() !== '') {
                const n = Number(v);
                return Number.isFinite(n) ? n : undefined;
            }
            return undefined;
        };

        const normalizePurpose = (value?: unknown): E_OrderPaymentPurpose => {
            if (typeof value === 'string') {
                const upper = value.trim().toUpperCase();
                if (upper === E_OrderPaymentPurpose.EVENT_POST)
                    return E_OrderPaymentPurpose.EVENT_POST;
            }
            return E_OrderPaymentPurpose.MEMBERSHIP;
        };

        const normalizePaymentType = (value?: unknown): E_NetvalvePaymentType | undefined => {
            if (typeof value !== 'string')
                return undefined;
            const upper = value.trim().toUpperCase();
            return (Object.values(E_NetvalvePaymentType) as string[]).includes(upper)
                ? (upper as E_NetvalvePaymentType)
                : undefined;
        };

        const currentUser = await authnCtr.getUserFromSession(context).catch(() => null);
        const userId = currentUser?.id;

        const amountRaw = input['amount'];
        const currencyRaw = input['currency'];
        const clientOrderId = toStr(input['clientOrderId']) ?? '';
        const successUrl = toStr(input['successUrl']) ?? '';
        const cancelUrl = toStr(input['cancelUrl']) ?? '';
        const failedUrl = toStr(input['failedUrl']) ?? '';
        const pendingUrl = toStr(input['pendingUrl']) ?? '';
        const orderDesc = toStr(input['orderDesc']) ?? '';
        const midId = toStr(input['midId']) ?? '';
        const customerDetails = (typeof input['customerDetails'] === 'object' && input['customerDetails'] !== null) ? input['customerDetails'] as Record<string, unknown> : undefined;
        const paymentPurpose = normalizePurpose(input['paymentPurpose']);
        const isEventPayment = paymentPurpose === E_OrderPaymentPurpose.EVENT_POST;
        const eventPayload = isEventPayment && typeof input['eventPayload'] === 'object' && input['eventPayload'] !== null
            ? input['eventPayload'] as Record<string, unknown>
            : undefined;
        const saleToken = toStr(input['token']);
        const resolvedPaymentType = normalizePaymentType(input['paymentType']);

        let resolvedAmount = toNum(amountRaw) ?? Number.NaN;
        let resolvedCurrency = toStr(currencyRaw)?.toUpperCase() ?? '';

        // derive price if amount missing
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            try {
                // Prefer explicit tax state/country provided in the request
                const taxStateId = toStr(input['taxStateId']) ?? '';
                const taxCountryId = toStr(input['taxCountryId']) ?? '';

                let pricingFound: any = null;

                if (taxStateId) {
                    const p = await pricingCtr.getPricing(context, { filter: { type: E_PricingType.MEMBERSHIP, stateId: taxStateId, isActive: true } });
                    if (p.success && p.result)
                        pricingFound = p.result;
                }

                if (!pricingFound && taxCountryId) {
                    const p = await pricingCtr.getPricing(context, { filter: { type: E_PricingType.MEMBERSHIP, countryId: taxCountryId, isActive: true } });
                    if (p.success && p.result)
                        pricingFound = p.result;
                }

                // Fallback to session/ip-based subscription pricing lookup
                if (!pricingFound) {
                    const priceRes = await pricingCtr.getSubscriptionPrice(context);
                    if (priceRes.success && priceRes.result) {
                        resolvedAmount = priceRes.result.price ?? resolvedAmount;
                        resolvedCurrency = priceRes.result.currency ?? resolvedCurrency;
                    }
                }
                else {
                    resolvedAmount = typeof pricingFound.price === 'number' ? pricingFound.price : resolvedAmount;
                    if (pricingFound.currency && pricingFound.currency.code) {
                        resolvedCurrency = pricingFound.currency.code;
                    }
                    else if (pricingFound.currencyId && typeof pricingFound.currencyId === 'string') {
                        resolvedCurrency = String(pricingFound.currencyId) || resolvedCurrency;
                    }
                }
            }
            catch {
                // continue; will validate below
            }
        }

        const errors: string[] = [];
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            errors.push('amount must be a positive number');
        }
        if (!resolvedCurrency) {
            errors.push('currency is required');
        }
        if (!clientOrderId) {
            errors.push('clientOrderId is required');
        }
        if (!isEventPayment) {
            if (!successUrl) {
                errors.push('successUrl is required');
            }
            if (!cancelUrl) {
                errors.push('cancelUrl is required');
            }
            if (!failedUrl) {
                errors.push('failedUrl is required');
            }
        }
        if (isEventPayment) {
            if (!userId) {
                errors.push('Authentication is required for EVENT_POST payments');
            }
            if (!saleToken) {
                errors.push('token is required for EVENT_POST payments');
            }
            if (!resolvedPaymentType) {
                errors.push(`paymentType must be one of: ${Object.values(E_NetvalvePaymentType).join(', ')}`);
            }
            if (!eventPayload) {
                errors.push('eventPayload is required for EVENT_POST payments');
            }
        }

        if (errors.length > 0) {
            return { success: false, message: errors.join(', '), code: RESPONSE_STATUS.BAD_REQUEST.CODE };
        }

        // create order
        const orderMeta: Record<string, unknown> = {};
        if (orderDesc)
            orderMeta['orderDesc'] = orderDesc;
        if (eventPayload)
            orderMeta['eventPayload'] = eventPayload;

        const orderDoc: Record<string, unknown> = {
            amount: resolvedAmount,
            currency: resolvedCurrency,
            externalGateway: E_PaymentProvider.NETVALVE,
            clientOrderId,
            paymentPurpose,
        };
        if (Object.keys(orderMeta).length > 0) {
            orderDoc['meta'] = orderMeta;
        }
        if (!isEventPayment) {
            orderDoc['successUrl'] = successUrl;
            orderDoc['cancelUrl'] = cancelUrl;
            orderDoc['pendingUrl'] = pendingUrl;
        }
        if (userId) {
            orderDoc['userId'] = userId;
        }
        if (customerDetails) {
            orderDoc['customerDetails'] = customerDetails;
        }
        if (midId) {
            orderDoc['gatewayMidId'] = midId;
        }

        const orderRes = await orderCtr.createOrder(context, { doc: orderDoc });
        if (!orderRes.success) {
            return { success: false, message: orderRes.message ?? 'Failed to create order', code: orderRes.code };
        }

        const createdOrder = orderRes.result ?? null;

        // try to reuse WAITING payment request
        const existingPr = await paymentRequestCtr.getPaymentRequest(context, { filter: { clientOrderId, status: E_PaymentRequestStatus.WAITING } });
        let paymentRequestResult = existingPr;
        if (!existingPr.success || !existingPr.result) {
            const prDoc: Record<string, unknown> = {
                orderId: createdOrder?._id ?? createdOrder?.id,
                clientOrderId,
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                gateway: E_PaymentProvider.NETVALVE,
                status: E_PaymentRequestStatus.WAITING,
                attempts: 0,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                meta: {
                    paymentPurpose,
                },
            };

            paymentRequestResult = await paymentRequestCtr.createPaymentRequest(context, { doc: prDoc });
        }

        if (!paymentRequestResult.success || !paymentRequestResult.result) {
            return { success: false, message: 'Failed to create or retrieve payment session', code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE };
        }

        const paymentRequest = paymentRequestResult.result;

        // call Netvalve
        let gatewayRes: I_Return<Record<string, unknown>>;
        let resultPayload: Record<string, unknown> | null = null;

        if (isEventPayment) {
            const salePayload: Record<string, unknown> = {
                token: saleToken,
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                paymentType: resolvedPaymentType,
                clientOrderId,
            };
            if (midId)
                salePayload['netvalveMidId'] = midId;
            gatewayRes = await netvalveCtr.sale(context, salePayload as any);
        }
        else {
            const payload: Record<string, unknown> = {
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                clientOrderId,
                successUrl,
                cancelUrl,
                failedUrl,
            };
            if (pendingUrl)
                (payload as any).pendingUrl = pendingUrl;
            if (orderDesc)
                (payload as any).orderDesc = orderDesc;
            if (midId)
                (payload as any).midId = midId;
            if (customerDetails)
                (payload as any).customerDetails = customerDetails;
            gatewayRes = await netvalveCtr.createOrder(context, payload as any);
        }

        if (!gatewayRes.success) {
            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: (isEventPayment ? 'SALE' : 'HPP_ORDER') as any,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: E_PaymentStatus.FAILED,
                success: false,
                errorMessage: gatewayRes.message ?? (isEventPayment ? 'Netvalve sale failed' : 'Netvalve HPP order creation failed'),
                responsePayload: ((gatewayRes as any).result as Record<string, unknown>) ?? null,
            });

            return { success: false, message: gatewayRes.message ?? undefined, code: gatewayRes.code };
        }

        resultPayload = (gatewayRes.result as Record<string, unknown> | null) ?? null;

        if (isEventPayment) {
            const statusRaw = typeof resultPayload?.['status'] === 'string'
                ? (resultPayload['status'] as string).toUpperCase()
                : '';
            const isPaidStatus = ['PAID', 'APPROVED', 'SUCCESS', 'COMPLETED'].includes(statusRaw);
            const transactionId = resultPayload && typeof resultPayload === 'object' && 'transactionId' in resultPayload
                ? String((resultPayload as any).transactionId)
                : (resultPayload && 'orderId' in resultPayload ? String((resultPayload as any).orderId) : undefined);

            await paymentRequestCtr.updatePaymentRequest(context, {
                filter: { _id: paymentRequest._id ?? paymentRequest.id },
                update: {
                    $set: {
                        status: isPaidStatus ? E_PaymentRequestStatus.PAID : E_PaymentRequestStatus.FAILED,
                        paymentUrl: null,
                        externalOrderId: transactionId ?? null,
                        gatewayResponse: resultPayload ?? null,
                        attempts: (paymentRequest.attempts ?? 0) + 1,
                    },
                },
            });

            await orderCtr.updateOrder(context, {
                filter: { _id: createdOrder?._id ?? createdOrder?.id },
                update: {
                    $set: {
                        externalOrderId: transactionId ?? null,
                        status: isPaidStatus ? E_OrderStatus.PAID : E_OrderStatus.FAILED,
                    },
                },
            });

            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: 'SALE' as any,
                orderId: createdOrder?.id,
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: isPaidStatus ? E_PaymentStatus.COMPLETED : E_PaymentStatus.FAILED,
                success: isPaidStatus,
                responsePayload: resultPayload ?? null,
            });

            if (!isPaidStatus) {
                return {
                    success: false,
                    message: `Payment status is ${statusRaw || 'UNKNOWN'}`,
                    code: RESPONSE_STATUS.BAD_REQUEST.CODE,
                };
            }

            const updatedOrder: I_Order = {
                ...(createdOrder ?? {}),
                status: E_OrderStatus.PAID,
                externalOrderId: transactionId ?? null,
            } as I_Order;

            const effects = await applyOrderPaidEffects(context, updatedOrder);

            return {
                success: true,
                message: effects.event ? 'Event created successfully.' : (gatewayRes.message ?? undefined),
                result: {
                    status: E_MakePaymentResultStatus.PAID,
                    redirectUrl: null,
                    externalOrderId: transactionId ?? null,
                    event: effects.event ?? null,
                    membershipExpiresAt: effects.membershipExpiresAt ?? null,
                    gatewayResponse: resultPayload ?? null,
                },
            };
        }

        // update payment request and order for HPP flow
        let paymentUrl: string | undefined;
        let externalOrderId: string | undefined;
        try {
            paymentUrl = resultPayload && typeof resultPayload === 'object' && 'redirectUrl' in resultPayload ? (resultPayload as any).redirectUrl : undefined;
            externalOrderId = resultPayload && typeof resultPayload === 'object' && 'orderId' in resultPayload ? (resultPayload as any).orderId : undefined;

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
                        status: paymentUrl ? E_OrderStatus.PENDING : E_OrderStatus.FAILED,
                    },
                },
            });

            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: 'HPP_ORDER' as any,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: paymentUrl ? E_PaymentStatus.PENDING : E_PaymentStatus.FAILED,
                success: true,
                responsePayload: resultPayload ?? null,
            });
        }
        catch {
            await paymentCtr.recordGatewayTransaction(context, {
                provider: E_PaymentProvider.NETVALVE,
                operation: 'HPP_ORDER' as any,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currencyId: resolvedCurrency,
                status: E_PaymentStatus.FAILED,
                success: false,
                errorMessage: 'Failed to update payment records',
                responsePayload: resultPayload ?? null,
            });
        }

        const membershipResult = {
            status: paymentUrl ? E_MakePaymentResultStatus.PENDING : E_MakePaymentResultStatus.FAILED,
            redirectUrl: paymentUrl ?? null,
            externalOrderId: externalOrderId ?? null,
            event: null,
            membershipExpiresAt: null,
            gatewayResponse: resultPayload ?? null,
        };

        return {
            success: true,
            message: gatewayRes.message ?? undefined,
            result: membershipResult,
        };
    },
};

export default paymentController;
