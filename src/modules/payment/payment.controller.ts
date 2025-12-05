import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Input_CreateOrder } from '#modules/order/order.type.js';
import type { I_NetvalveHppOrderPayload } from '#modules/payment/netvalve/index.js';
import type { I_Pricing } from '#modules/pricing/pricing.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { countryCtr } from '#modules/location/country/country.controller.js';
import { currencyCtr } from '#modules/location/currency/index.js';
import { stateCtr } from '#modules/location/state/state.controller.js';
import orderCtr from '#modules/order/order.controller.js';
import { E_OrderStatus } from '#modules/order/order.type.js';
import { netvalveCtr } from '#modules/payment/netvalve/index.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { PricingModel } from '#modules/pricing/pricing.model.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';
import { userCtr } from '#modules/user/user.controller.js';

import type { I_Input_MakePayment, I_MakePaymentResult } from './payment.type.js';

import { getPaymentUrls } from './payment.handler.js';
import { E_PaymentMethod, E_PaymentStatus } from './payment.type.js';

const pricingMongooseCtr = new MongooseController<I_Pricing>(PricingModel);

/**
 * Map country currency to supported payment currencies (EUR or USD)
 * Europe, Africa, Middle East -> EUR
 * Americas, Asia-Pacific -> USD (default EUR for others)
 */
function mapCurrencyToSupported(currencyCode?: string, countryRegion?: string): 'EUR' | 'USD' {
    if (!currencyCode) {
        return 'EUR'; // Default
    }

    const upperCurrency = currencyCode.toUpperCase();
    const upperRegion = countryRegion?.toLowerCase() || '';

    // If already EUR or USD, return as is
    if (upperCurrency === 'EUR' || upperCurrency === 'USD') {
        return upperCurrency;
    }

    // Map based on region
    if (upperRegion.includes('europe') || upperRegion.includes('africa') || upperRegion.includes('middle')) {
        return 'EUR';
    }
    if (upperRegion.includes('america') || upperRegion.includes('north') || upperRegion.includes('south')) {
        return 'USD';
    }

    // Default to EUR for other regions (Asia, etc.)
    return 'EUR';
}

export const paymentController = {
    /**
     * Make payment - BE automatically gets userId from session and finds pricing based on user location
     */
    async makePayment(context: I_Context, { input: _input }: { input: I_Input_MakePayment }): Promise<I_Return<I_MakePaymentResult>> {
        // BE automatically gets userId from session (not from FE input)
        const currentUser = await authnCtr.getUserFromSession(context);
        if (!currentUser) {
            throwError({ status: RESPONSE_STATUS.UNAUTHORIZED, message: 'Unauthorized' });
        }

        let latitude: number | undefined;
        let longitude: number | undefined;
        let countryId: string | undefined;
        let stateId: string | undefined;

        // Get location info from user (temporaryLocation or partner1.location)
        if (currentUser?.id) {
            try {
                const userFound = await userCtr.getUser(context, {
                    filter: { id: currentUser.id },
                    populate: ['settings.temporaryLocation.location', 'partner1.location'],
                });

                if (userFound.success && userFound.result) {
                    const user = userFound.result;

                    // Priority 1: Check temporaryLocation
                    const tempLocation = user.settings?.temporaryLocation?.location;
                    if (tempLocation) {
                        // Use stateId/countryId directly from location if available
                        if (tempLocation.stateId) {
                            stateId = tempLocation.stateId;
                        }
                        if (tempLocation.countryId) {
                            countryId = tempLocation.countryId;
                        }
                        // If no stateId but have coordinates, use coordinates to find state
                        if (!stateId && tempLocation.map) {
                            const tempMap = tempLocation.map;
                            if (
                                typeof tempMap.latitude === 'number'
                                && typeof tempMap.longitude === 'number'
                                && Number.isFinite(tempMap.latitude)
                                && Number.isFinite(tempMap.longitude)
                            ) {
                                latitude = tempMap.latitude;
                                longitude = tempMap.longitude;
                            }
                        }
                    }

                    // Priority 2: Fallback to partner1.location
                    if (!stateId && !countryId && user.partner1?.location) {
                        const partnerLocation = user.partner1.location;
                        // Use stateId/countryId directly from location if available
                        if (partnerLocation.stateId) {
                            stateId = partnerLocation.stateId;
                        }
                        if (partnerLocation.countryId) {
                            countryId = partnerLocation.countryId;
                        }
                        // If no stateId but have coordinates, use coordinates to find state
                        if (!stateId && partnerLocation.map) {
                            const partnerMap = partnerLocation.map;
                            if (
                                typeof partnerMap.latitude === 'number'
                                && typeof partnerMap.longitude === 'number'
                                && Number.isFinite(partnerMap.latitude)
                                && Number.isFinite(partnerMap.longitude)
                            ) {
                                latitude = partnerMap.latitude;
                                longitude = partnerMap.longitude;
                            }
                        }
                    }
                }
            }
            catch (error) {
                log.warn('Failed to get user location:', error);
            }
        }

        // Find state by coordinates if lat/long available and stateId not found yet
        if (!stateId && latitude != null && longitude != null && !Number.isNaN(latitude) && !Number.isNaN(longitude)) {
            const stateRes = await stateCtr.getState(context, {
                filter: {
                    latitude: latitude.toString(),
                    longitude: longitude.toString(),
                    isDel: false,
                },
            });
            if (stateRes.success && stateRes.result) {
                stateId = stateRes.result.id;
                // Use countryId from state if not already set (more accurate)
                if (!countryId && stateRes.result.countryId) {
                    countryId = stateRes.result.countryId;
                }
            }
        }

        // Find pricing based on state/country (same logic as getSubscriptionPrice)
        let pricing: I_Pricing | undefined;

        // Priority 1: Try to find pricing by stateId (most specific)
        if (stateId) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    type: E_PricingType.MEMBERSHIP,
                    stateId,
                    isActive: true,
                    isDel: false,
                },
                undefined,
                undefined,
                ['currency'],
            );
            if (pricingRes.success && pricingRes.result) {
                pricing = pricingRes.result;
            }
        }

        // Priority 2: Try to find pricing by countryId (fallback)
        if (!pricing && countryId) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    type: E_PricingType.MEMBERSHIP,
                    countryId,
                    isActive: true,
                    isDel: false,
                },
                undefined,
                undefined,
                ['currency'],
            );
            if (pricingRes.success && pricingRes.result) {
                pricing = pricingRes.result;
            }
        }

        // Priority 3: Try to find default pricing (no country/state)
        if (!pricing) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    type: E_PricingType.MEMBERSHIP,
                    isActive: true,
                    isDel: false,
                    $or: [{ countryId: null }, { countryId: '' }, { countryId: { $exists: false } }],
                },
                undefined,
                undefined,
                ['currency'],
            );
            if (pricingRes.success && pricingRes.result) {
                pricing = pricingRes.result;
            }
        }

        if (!pricing) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Pricing not found for your location',
            });
        }
        const pricingType = pricing.type ?? E_PricingType.MEMBERSHIP;

        log.warn('[Payment] Pricing loaded:', {
            pricingId: pricing.id,
            countryId: pricing.countryId,
            stateId: pricing.stateId,
            basePrice: pricing.price,
            taxRate: pricing.taxRate,
            currencyId: pricing.currencyId,
            hasCurrency: !!pricing.currency,
            currencyCode: pricing.currency?.code,
        });

        const baseAmount = typeof pricing.price === 'number' ? pricing.price : Number.NaN;
        const taxRate = typeof pricing.taxRate === 'number' ? pricing.taxRate : 0;

        if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Pricing amount is invalid',
            });
        }
        const taxPortion = baseAmount * (taxRate / 100);
        const resolvedAmount = Number((baseAmount + taxPortion).toFixed(2));

        log.warn('[Payment] Amount calculation:', {
            baseAmount,
            taxRate,
            taxPortion,
            resolvedAmount,
        });

        let currencyCode = pricing.currency?.code;

        // Fallback 1: if currency is not populated, load it manually by currencyId
        if (!currencyCode && pricing.currencyId) {
            log.warn('[Payment] Currency not populated, loading manually with currencyId:', pricing.currencyId);
            const currencyRes = await currencyCtr.getCurrency(context, { filter: { id: pricing.currencyId } });
            if (currencyRes.success && 'result' in currencyRes && currencyRes.result) {
                log.warn('[Payment] Currency load result:', {
                    success: currencyRes.success,
                    code: currencyRes.result.code,
                    symbol: currencyRes.result.symbol,
                });
                currencyCode = currencyRes.result.code || currencyRes.result.symbol;
            }
            else {
                log.warn('[Payment] Failed to load currency:', {
                    success: currencyRes.success,
                    message: 'message' in currencyRes ? currencyRes.message : undefined,
                });
            }
        }

        // Get country info for currency mapping
        let countryRegion: string | undefined;
        if (pricing.countryId) {
            const countryRes = await countryCtr.getCountry(context, { filter: { id: pricing.countryId }, populate: ['region'] });
            if (countryRes.success && 'result' in countryRes && countryRes.result) {
                const country = countryRes.result;
                countryRegion = (country.region as any)?.name || undefined;
                // Fallback: if no currency from pricing, try country currency
                if (!currencyCode && country.currency) {
                    currencyCode = country.currency;
                    log.warn('[Payment] Got currency from country:', currencyCode);
                }
            }
        }

        // Fallback: if still no currency and pricing has country populated, use country.currency
        if (!currencyCode && (pricing.country as any)?.currency) {
            currencyCode = (pricing.country as any).currency;
            countryRegion = (pricing.country as any)?.region?.name || undefined;
            log.warn('[Payment] Got currency from populated country:', currencyCode);
        }

        // Map currency to supported payment currencies (EUR or USD)
        // Only EUR and USD are supported by payment gateway
        const mappedCurrencyCode = mapCurrencyToSupported(currencyCode, countryRegion);

        log.warn('[Payment] Currency mapping:', {
            originalCurrency: currencyCode,
            mappedCurrency: mappedCurrencyCode,
            countryRegion,
            pricingId: pricing.id,
            countryId: pricing.countryId,
        });

        if (!mappedCurrencyCode) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Pricing currency is missing',
            });
        }

        // Use mapped currency for payment
        currencyCode = mappedCurrencyCode;

        // Create order first - clientOrderId will be set to order.id after creation
        // userId is automatically set from currentUser (BE), not from FE input
        const orderDoc: I_Input_CreateOrder = {
            userId: currentUser.id, // BE automatically sets userId from session
            amount: resolvedAmount,
            pricingId: pricing.id, // From auto-detected pricing
        };

        const orderRes = await orderCtr.createOrder(context, { doc: orderDoc });

        if (!orderRes.success || !orderRes.result) {
            throwError({
                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                message:
                orderRes.message ?? 'Failed to create order',
            });
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
            gateway: E_PaymentProvider.NETVALVE,
            status: E_PaymentRequestStatus.WAITING,
            attempts: 0,
            meta: {
                orderId: createdOrder.id,
                clientOrderId,
                amount: resolvedAmount,
                currencyId: pricing.currencyId,
                pricingId: pricing.id,
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

        const paymentUrls = getPaymentUrls();
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

        const hppResponse = await netvalveCtr.createOrder(context, hppPayload as I_NetvalveHppOrderPayload);

        if (!hppResponse.success || !hppResponse.result) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: hppResponse.message ?? 'Failed to initiate payment',
            });
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
            pricingId: pricing.id,
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
