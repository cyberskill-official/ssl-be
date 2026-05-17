import type { I_Order } from '#modules/order/order.type.js';
import type { I_PaymentRequest } from '#modules/payment/payment-request/payment-request.type.js';

import { OrderModel } from '#modules/order/order.model.js';
import { E_OrderType } from '#modules/order/order.type.js';
import { PaymentRequestModel } from '#modules/payment/payment-request/payment-request.model.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';

const PAYPAL_SUBSCRIPTION_ID_REGEX = /^I-/;

export interface I_PayPalSubscriptionLink {
    userId: string;
    subscriptionId: string | null;
    paymentRequestId: string | null;
    orderId: string | null;
    source: 'payment-request-user' | 'payment-request-order' | 'none';
    paymentRequest?: I_PaymentRequest | null;
    order?: I_Order | null;
}

function getMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
    const value = meta?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildLink(
    userId: string,
    source: I_PayPalSubscriptionLink['source'],
    paymentRequest?: I_PaymentRequest | null,
    order?: I_Order | null,
): I_PayPalSubscriptionLink {
    const meta = paymentRequest?.meta as Record<string, unknown> | null | undefined;
    return {
        userId,
        source,
        subscriptionId: paymentRequest?.externalOrderId ?? null,
        paymentRequestId: paymentRequest?.id ?? null,
        orderId: getMetaString(meta, 'orderId') ?? order?.id ?? null,
        paymentRequest: paymentRequest ?? null,
        order: order ?? null,
    };
}

export async function findLatestPayPalSubscriptionForUser(userId: string): Promise<I_PayPalSubscriptionLink> {
    const directPaymentRequest = await PaymentRequestModel.findOne({
        'gateway': E_PaymentProvider.PAYPAL,
        'externalOrderId': { $regex: PAYPAL_SUBSCRIPTION_ID_REGEX },
        'meta.userId': userId,
        'isDel': { $ne: true },
    })
        .sort({ createdAt: -1 })
        .lean<I_PaymentRequest>()
        .exec();

    if (directPaymentRequest?.externalOrderId) {
        return buildLink(userId, 'payment-request-user', directPaymentRequest);
    }

    const orders = await OrderModel.find({
        userId,
        orderType: E_OrderType.SUBSCRIPTION,
        isDel: { $ne: true },
    }, {
        id: 1,
        userId: 1,
        status: 1,
        orderType: 1,
        paymentTransactionId: 1,
        pricingId: 1,
        createdAt: 1,
        updatedAt: 1,
    })
        .sort({ createdAt: -1 })
        .lean<I_Order[]>()
        .exec();

    const orderIds = orders
        .map(order => order.id)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (orderIds.length === 0) {
        return buildLink(userId, 'none');
    }

    const paymentRequestByOrder = await PaymentRequestModel.findOne({
        'gateway': E_PaymentProvider.PAYPAL,
        'externalOrderId': { $regex: PAYPAL_SUBSCRIPTION_ID_REGEX },
        'meta.orderId': { $in: orderIds },
        'isDel': { $ne: true },
    })
        .sort({ createdAt: -1 })
        .lean<I_PaymentRequest>()
        .exec();

    if (!paymentRequestByOrder?.externalOrderId) {
        return buildLink(userId, 'none');
    }

    const meta = paymentRequestByOrder.meta as Record<string, unknown> | null | undefined;
    const orderId = getMetaString(meta, 'orderId');
    const order = orderId ? orders.find(item => item.id === orderId) ?? null : null;

    return buildLink(userId, 'payment-request-order', paymentRequestByOrder, order);
}

export function isPayPalSubscriptionId(value: unknown): value is string {
    return typeof value === 'string' && PAYPAL_SUBSCRIPTION_ID_REGEX.test(value.trim());
}
