import type { I_Input_CreateOne } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';

import type { I_Context } from '#shared/typescript/index.js';

import { orderCtr } from '#modules/order/order.controller.js';
import { netvalveCtr } from '#modules/payment/netvalve/netvalve.controller.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/payment-request.controller.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { paymentCtr } from '#modules/payment/payment-transaction/payment-transaction.controller.js';
import { pricingCtr } from '#modules/pricing/pricing.controller.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';

export const paymentController = {
    async makePayment(context: I_Context, { doc }: I_Input_CreateOne<Record<string, unknown>>): Promise<I_Return<Record<string, unknown>>> {
        // normalize inputs (use typed helpers, avoid `any`)
        const input = doc as import('./payment.type.js').I_Input_MakePayment;

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
        if (!successUrl) {
            errors.push('successUrl is required');
        }
        if (!cancelUrl) {
            errors.push('cancelUrl is required');
        }
        if (!failedUrl) {
            errors.push('failedUrl is required');
        }

        if (errors.length > 0) {
            return { success: false, message: errors.join(', '), code: RESPONSE_STATUS.BAD_REQUEST.CODE };
        }

        // create order
        const orderDoc: Record<string, unknown> = {
            amount: resolvedAmount,
            currency: resolvedCurrency,
            successUrl,
            cancelUrl,
            pendingUrl,
            externalGateway: 'NETVALVE',
            clientOrderId,
        };
        if (customerDetails) {
            (orderDoc as any)['customerDetails'] = customerDetails;
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
                currency: resolvedCurrency,
                gateway: 'NETVALVE',
                status: E_PaymentRequestStatus.WAITING,
                attempts: 0,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            };

            paymentRequestResult = await paymentRequestCtr.createPaymentRequest(context, { doc: prDoc });
        }

        if (!paymentRequestResult.success || !paymentRequestResult.result) {
            return { success: false, message: 'Failed to create or retrieve payment session', code: RESPONSE_STATUS.INTERNAL_SERVER_ERROR.CODE };
        }

        const paymentRequest = paymentRequestResult.result;

        // call Netvalve
        const payload: Record<string, unknown> = {
            amount: resolvedAmount,
            currency: resolvedCurrency,
            clientOrderId,
            successUrl,
            cancelUrl,
            failedUrl,
        };
        if (pendingUrl)
            (payload as any)['pendingUrl'] = pendingUrl;
        if (orderDesc)
            (payload as any)['orderDesc'] = orderDesc;
        if (midId)
            (payload as any)['midId'] = midId;
        if (customerDetails)
            (payload as any)['customerDetails'] = customerDetails;

        const gatewayRes = await netvalveCtr.createOrder(context, payload as any);

        if (!gatewayRes.success) {
            // record failed transaction
            await paymentCtr.recordGatewayTransaction(context, {
                provider: 'NETVALVE' as any,
                operation: 'HPP_ORDER' as any,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currency: resolvedCurrency,
                status: 'FAILED',
                success: false,
                errorMessage: gatewayRes.message ?? 'Netvalve HPP order creation failed',
                responsePayload: ((gatewayRes as any).result as Record<string, unknown>) ?? null,
            });

            return { success: false, message: gatewayRes.message ?? undefined, code: gatewayRes.code };
        }

        const resultPayload = gatewayRes.result ?? null;

        // update payment request and order
        try {
            const paymentUrl = resultPayload && typeof resultPayload === 'object' && 'redirectUrl' in resultPayload ? (resultPayload as any).redirectUrl : undefined;
            const externalOrderId = resultPayload && typeof resultPayload === 'object' && 'orderId' in resultPayload ? (resultPayload as any).orderId : undefined;

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

            await paymentCtr.recordGatewayTransaction(context, {
                provider: 'NETVALVE' as any,
                operation: 'HPP_ORDER' as any,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currency: resolvedCurrency,
                status: paymentUrl ? 'PENDING' : 'FAILED',
                success: true,
                responsePayload: (resultPayload as Record<string, unknown>) ?? null,
            });
        }
        catch {
            // log via payment transaction and continue
            await paymentCtr.recordGatewayTransaction(context, {
                provider: 'NETVALVE' as any,
                operation: 'HPP_ORDER' as any,
                orderId: String(createdOrder?._id ?? createdOrder?.id ?? ''),
                amount: resolvedAmount,
                currency: resolvedCurrency,
                status: 'FAILED',
                success: false,
                errorMessage: 'Failed to update payment records',
                responsePayload: (resultPayload as Record<string, unknown>) ?? null,
            });
        }

        return { success: true, message: gatewayRes.message ?? undefined, result: resultPayload };
    },
};

export default paymentController;
