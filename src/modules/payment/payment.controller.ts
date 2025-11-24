import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { eventCtr } from '#modules/event/index.js';
import { orderCtr } from '#modules/order/index.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { netvalveCtr } from '#modules/payment/netvalve/index.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { pricingCtr } from '#modules/pricing/index.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';

import type { I_Input_MakePayment, I_MakePaymentResult } from './payment.type.js';

import { getPaymentUrls } from './payment.handler.js';
import { E_PaymentMethod, E_PaymentStatus } from './payment.type.js';

const toStr = (value: unknown): string | undefined => typeof value === 'string' ? value.trim() : undefined;

export const paymentController = {
    /**
     * Make payment - BE automatically gets userId from session, FE only needs to pass pricingId
     */
    async makePayment(context: I_Context, { input }: { input: I_Input_MakePayment }): Promise<I_Return<I_MakePaymentResult>> {
        // BE automatically gets userId from session (not from FE input)
        const currentUser = await authnCtr.getUserFromSession(context);
        if (!currentUser) {
            throwError({ status: RESPONSE_STATUS.UNAUTHORIZED, message: 'Unauthorized' });
        }

        // FE only needs to pass: pricingId (no country validation)
        const pricingId = toStr(input.pricingId); // Required from FE

        const errors: string[] = [];
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

        const baseAmount = typeof pricing.price === 'number' ? pricing.price : Number.NaN;
        const taxRate = typeof pricing.taxRate === 'number' ? pricing.taxRate : 0;
        if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Pricing amount is invalid' });
        }
        const taxPortion = baseAmount * (taxRate / 100);
        const resolvedAmount = Number((baseAmount + taxPortion).toFixed(2));

        const currencyCode = pricing.currency?.code?.toUpperCase();
        if (!currencyCode) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: 'Pricing currency is missing' });
        }

        // Create order first - clientOrderId will be set to order.id after creation
        // userId is automatically set from currentUser (BE), not from FE input
        const orderDoc: Record<string, unknown> = {
            userId: currentUser.id, // BE automatically sets userId from session
            amount: resolvedAmount,
            currencyId: pricing.currencyId,
            externalGateway: E_PaymentProvider.NETVALVE,
            pricingId, // From FE input
            pricingType,
        };

        // For ANNOUNCEMENT payment, save event or eventId to order.meta for later processing
        if (pricingType === E_PricingType.ANNOUNCEMENT) {
            const meta: Record<string, unknown> = {};

            if (input.eventId) {
                // If eventId is provided, fetch event from database
                const eventRes = await eventCtr.getEvent(context, { filter: { id: input.eventId } });
                if (!eventRes.success || !eventRes.result) {
                    throwError({ status: RESPONSE_STATUS.NOT_FOUND, message: 'Event not found' });
                }
                meta['eventId'] = input.eventId;
                meta['event'] = eventRes.result; // Store event data for later use
            }
            else if (input.event) {
                // If event object is provided, save it directly
                meta['event'] = input.event;
            }

            if (Object.keys(meta).length > 0) {
                orderDoc['meta'] = meta;
            }
        }

        const orderRes = await orderCtr.createOrder(context, { doc: orderDoc });
        if (!orderRes.success || !orderRes.result) {
            throwError({ status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR, message: orderRes.message ?? 'Failed to create order' });
        }
        const createdOrder = orderRes.result;

        // clientOrderId is the order ID in our system (used for Netvalve HPP)
        const clientOrderId = createdOrder.id;

        // Update order with clientOrderId
        await orderCtr.updateOrder(context, {
            filter: { id: createdOrder.id },
            update: {
                $set: {
                    clientOrderId,
                },
            },
        });

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

        // Build customerDetails - email and phone are required for 3DS Visa mandate
        // See: https://docs.netvalve.com/#tag/Hosted-Payment-Page/operation/createOrder
        // Note: customerPhone format should be "+countrycode-phonenumber" (e.g., "+919900000000")
        const customerDetails: Record<string, string> = {};
        if (currentUser.email) {
            customerDetails['customerEmail'] = currentUser.email;
        }
        // Get customer IP from request context
        // Express sets req.ip if trust proxy is enabled, otherwise use socket.remoteAddress
        const customerIp = (context.req as any)?.ip || (context.req as any)?.connection?.remoteAddress || undefined;
        if (customerIp) {
            customerDetails['customerIp'] = customerIp;
        }
        // TODO: Add customerPhone when available in user model or input
        // customerDetails['customerPhone'] = '+1234567890'; // Format: +countrycode-phonenumber

        const paymentUrls = getPaymentUrls(clientOrderId);
        const hppPayload: Record<string, unknown> = {
            amount: resolvedAmount,
            currency: currencyCode,
            clientOrderId,
            successUrl: paymentUrls.successUrl,
            cancelUrl: paymentUrls.cancelUrl,
            failedUrl: paymentUrls.failedUrl,
            pendingUrl: paymentUrls.pendingUrl,
        };
        // Always include customerDetails if we have at least email (required for 3DS)
        if (customerDetails['customerEmail'] || Object.keys(customerDetails).length > 0) {
            hppPayload['customerDetails'] = customerDetails;
        }

        const hppResponse = await netvalveCtr.createOrder(context, hppPayload as any);
        if (!hppResponse.success || !hppResponse.result) {
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: hppResponse.message ?? 'Failed to initiate payment' });
        }

        const hppPayloadResult = hppResponse.result as Record<string, unknown>;

        // Validate response according to Netvalve HPP documentation
        // See: https://docs.netvalve.com/#tag/Hosted-Payment-Page
        // responseCode "GTW_1000" and orderState "CREATED" indicate success
        const responseCode = typeof hppPayloadResult?.['responseCode'] === 'string' ? hppPayloadResult['responseCode'] : '';
        const orderState = typeof hppPayloadResult?.['orderState'] === 'string' ? hppPayloadResult['orderState'] : '';
        const redirectUrl = typeof hppPayloadResult?.['redirectUrl'] === 'string' ? hppPayloadResult['redirectUrl'] : undefined;
        const externalOrderId = hppPayloadResult?.['orderId'] ? String(hppPayloadResult['orderId']) : undefined;

        // Check if order was successfully created
        const isSuccess = responseCode === 'GTW_1000' && orderState === 'CREATED' && redirectUrl;
        if (!isSuccess) {
            const errorMessage = typeof hppPayloadResult?.['responseMessage'] === 'string'
                ? hppPayloadResult['responseMessage']
                : `Payment gateway error: responseCode=${responseCode}, orderState=${orderState}`;
            throwError({ status: RESPONSE_STATUS.BAD_REQUEST, message: errorMessage });
        }

        await paymentRequestCtr.updatePaymentRequest(context, {
            filter: { id: paymentRequest.id },
            update: {
                $set: {
                    status: E_PaymentRequestStatus.PENDING,
                    paymentUrl: redirectUrl ?? null,
                    externalOrderId: externalOrderId ?? undefined,
                    gatewayResponse: hppPayloadResult ?? null,
                    attempts: (paymentRequest.attempts ?? 0) + 1,
                },
            },
        });

        await orderCtr.updateOrder(context, {
            filter: { id: createdOrder.id },
            update: {
                $set: {
                    status: E_OrderStatus.PENDING,
                    externalOrderId: externalOrderId ?? undefined,
                },
            },
        });

        // Payment method will be selected by user on HPP page, default to CARD
        const paymentResult: I_MakePaymentResult = {
            orderId: createdOrder.id,
            amount: resolvedAmount,
            currencyCode,
            paymentMethod: E_PaymentMethod.CARD, // Default, user selects on HPP
            paymentStatus: E_PaymentStatus.PENDING,
            pricingId: pricingId!,
            redirectUrl,
        };

        return {
            success: true,
            message: hppResponse.message ?? 'Payment initiated',
            result: paymentResult,
        };
    },
};

export default paymentController;
