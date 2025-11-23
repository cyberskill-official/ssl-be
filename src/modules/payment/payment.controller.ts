import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { randomUUID } from 'node:crypto';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { orderCtr } from '#modules/order/index.js';
import { applyOrderPaidEffects } from '#modules/order/order.effect.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { netvalveCtr } from '#modules/payment/netvalve/index.js';
import { E_NetvalvePaymentType } from '#modules/payment/netvalve/netvalve.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { pricingCtr } from '#modules/pricing/index.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';

import type { I_Input_MakePayment, I_MakePaymentResult } from './payment.type.js';

import { E_PaymentMethod, E_PaymentStatus } from './payment.type.js';

const toStr = (value: unknown): string | undefined => typeof value === 'string' ? value.trim() : undefined;
function toNum(value: unknown): number | undefined {
    if (typeof value === 'number')
        return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

function mapPaymentTypeToNetvalve(method?: E_PaymentMethod): E_NetvalvePaymentType {
    switch (method) {
        case E_PaymentMethod.WALLET:
            return E_NetvalvePaymentType.WALLET;
        case E_PaymentMethod.TOKEN:
            return E_NetvalvePaymentType.TOKEN;
        default:
            return E_NetvalvePaymentType.CARD;
    }
}

export const paymentController = {
    async makePayment(context: I_Context, { input }: { input: I_Input_MakePayment }): Promise<I_Return<I_MakePaymentResult>> {
        const currentUser = await authnCtr.getUserFromSession(context);
        if (!currentUser) {
            throwError({ status: RESPONSE_STATUS.UNAUTHORIZED, message: 'Unauthorized' });
        }

        const cardNumber = toStr(input.cardNumber);
        const cardName = toStr(input.cardName);
        const cardExpiryMonth = toStr(input.cardExpiryMonth);
        const cardExpiryYear = toStr(input.cardExpiryYear);
        const cardCvc = toStr(input.cardCvc);
        const pricingId = toStr(input.pricingId);
        const requestedAmount = toNum(input.amount);
        const clientOrderId = toStr(input.clientOrderId) ?? randomUUID();
        const paymentMethod = input.paymentType ?? E_PaymentMethod.CARD;
        const netvalvePaymentType = mapPaymentTypeToNetvalve(paymentMethod);

        const errors: string[] = [];
        if (!cardName)
            errors.push('cardName is required');
        if (!cardNumber)
            errors.push('cardNumber is required');
        if (!cardExpiryMonth)
            errors.push('cardExpiryMonth is required');
        if (!cardExpiryYear)
            errors.push('cardExpiryYear is required');
        if (!cardCvc)
            errors.push('cardCvc is required');
        if (!pricingId)
            errors.push('pricingId is required');

        if (errors.length > 0) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: errors.join(', ') });
        }

        const pricingRes = await pricingCtr.getPricing(context, {
            filter: { id: pricingId },
            populate: ['currency'],
        });
        if (!pricingRes.success || !pricingRes.result) {
            throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'Pricing not found' });
        }
        const pricing = pricingRes.result;
        const pricingType = pricing.type ?? E_PricingType.MEMBERSHIP;

        const resolvedAmount = requestedAmount ?? pricing.price ?? Number.NaN;
        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'amount must be a positive number' });
        }

        const currencyCode = pricing.currency?.code?.toUpperCase();
        if (!currencyCode) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Pricing currency is missing' });
        }

        const orderDoc: Record<string, unknown> = {
            userId: currentUser.id,
            amount: resolvedAmount,
            currencyId: pricing.currencyId,
            externalGateway: E_PaymentProvider.NETVALVE,
            clientOrderId,
            pricingId,
            pricingType,
        };
        if (pricingType === E_PricingType.ANNOUNCEMENT && input.eventPayload && typeof input.eventPayload === 'object') {
            orderDoc['meta'] = { eventPayload: input.eventPayload };
        }

        const orderRes = await orderCtr.createOrder(context, { doc: orderDoc });
        if (!orderRes.success || !orderRes.result) {
            throwError({ status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR, message: orderRes.message ?? 'Failed to create order' });
        }
        const createdOrder = orderRes.result;

        const prDoc = {
            orderId: createdOrder.id,
            clientOrderId,
            amount: resolvedAmount,
            currencyId: pricing.currencyId,
            gateway: E_PaymentProvider.NETVALVE,
            status: E_PaymentRequestStatus.WAITING,
            attempts: 0,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            meta: {
                pricingId,
                pricingType,
            },
        };
        const prRes = await paymentRequestCtr.createPaymentRequest(context, { doc: prDoc });
        if (!prRes.success || !prRes.result) {
            throwError({ status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR, message: 'Failed to create payment request' });
        }
        const paymentRequest = prRes.result;

        const salePayload = {
            token: cardNumber!,
            amount: resolvedAmount,
            currency: currencyCode,
            paymentType: netvalvePaymentType,
            clientOrderId,
        };
        const gatewayRes = await netvalveCtr.sale(context, salePayload);
        if (!gatewayRes.success) {
            throwError({ message: gatewayRes.message, status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const resultPayload = (gatewayRes.result as Record<string, unknown> | null) ?? null;
        const statusRaw = typeof resultPayload?.['status'] === 'string' ? resultPayload['status'].toUpperCase() : '';
        const isPaidStatus = ['PAID'].includes(statusRaw);
        const externalOrderId = resultPayload && typeof resultPayload === 'object' && 'transactionId' in resultPayload
            ? String(resultPayload['transactionId'])
            : undefined;

        await paymentRequestCtr.updatePaymentRequest(context, {
            filter: { id: paymentRequest.id },
            update: {
                $set: {
                    status: isPaidStatus ? E_PaymentRequestStatus.PAID : E_PaymentRequestStatus.FAILED,
                    paymentUrl: null,
                    externalOrderId: externalOrderId ?? undefined,
                    gatewayResponse: resultPayload ?? null,
                    attempts: (paymentRequest.attempts ?? 0) + 1,
                },
            },
        });

        await orderCtr.updateOrder(context, {
            filter: { id: createdOrder.id },
            update: {
                $set: {
                    status: isPaidStatus ? E_OrderStatus.PAID : E_OrderStatus.FAILED,
                    externalOrderId: externalOrderId ?? undefined,
                },
            },
        });

        if (!isPaidStatus) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: `Payment status is ${statusRaw || 'UNKNOWN'}` });
        }

        const paidOrder = {
            ...createdOrder,
            status: E_OrderStatus.PAID,
            externalOrderId: externalOrderId ?? undefined,
        };
        await applyOrderPaidEffects(context, paidOrder);

        const paymentResult: I_MakePaymentResult = {
            orderId: createdOrder.id,
            amount: resolvedAmount,
            currencyCode,
            paymentMethod,
            paymentStatus: E_PaymentStatus.SUCCESS,
            pricingId: pricingId!,
        };

        return {
            success: true,
            message: gatewayRes.message ?? 'Payment successful',
            result: paymentResult,
        };
    },
};

export default paymentController;
