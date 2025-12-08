import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
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
import { pricingCtr } from '#modules/pricing/pricing.controller.js';
import { PricingModel } from '#modules/pricing/pricing.model.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';

import type { I_Input_MakePayment, I_MakePaymentResult } from './payment.type.js';

import { getPaymentUrls } from './payment.handler.js';
import { E_PaymentMethod, E_PaymentStatus } from './payment.type.js';

const pricingMongooseCtr = new MongooseController<I_Pricing>(PricingModel);

export const paymentController = {
    /**
     * Make payment - BE automatically gets userId from session and finds pricing based on user location
     */
    async makePayment(context: I_Context, { input }: { input: I_Input_MakePayment }): Promise<I_Return<I_MakePaymentResult>> {
        // BE automatically gets userId from session (not from FE input)
        const currentUser = await authnCtr.getUserFromSession(context);
        if (!currentUser) {
            throwError({ status: RESPONSE_STATUS.UNAUTHORIZED, message: 'Unauthorized' });
        }

        // Parse loc (latitude,longitude) from FE geolocation IP
        let latitude: number | undefined;
        let longitude: number | undefined;
        if (input.loc && typeof input.loc === 'string') {
            const [latStr, longStr] = input.loc.split(',');
            if (latStr && longStr) {
                latitude = Number.parseFloat(latStr.trim());
                longitude = Number.parseFloat(longStr.trim());
            }
        }

        // Find state by coordinates (loc) if available
        let stateId: string | undefined;
        let countryId: string | undefined;
        if (latitude != null && longitude != null && !Number.isNaN(latitude) && !Number.isNaN(longitude)) {
            const stateRes = await stateCtr.getState(context, {
                filter: {
                    latitude: latitude.toString(),
                    longitude: longitude.toString(),
                    isDel: false,
                },
            });
            if (stateRes.success && stateRes.result) {
                stateId = stateRes.result.id;
                countryId = stateRes.result.countryId;
            }
        }

        // Find countryId from countryCode if not found from state
        if (!countryId && input.countryCode) {
            const countryFound = await countryCtr.getCountries(context, { filter: { iso2: input.countryCode } });
            if (countryFound.success && countryFound.result.docs?.[0]) {
                countryId = countryFound.result.docs[0].id;
            }
        }

        // Find pricing - ensure currency is populated
        // Use string format 'currency' to match how it's used elsewhere in the system
        let pricing: I_Pricing | undefined;

        // Priority 0: If pricingId is provided, use that pricing directly
        if (input.pricingId) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    id: input.pricingId,
                    type: E_PricingType.MEMBERSHIP,
                    isActive: true,
                    isDel: false,
                },
                undefined,
                undefined,
                'currency',
            );
            if (pricingRes.success && pricingRes.result) {
                pricing = pricingRes.result;
                // Ensure currencyId is preserved even after populate
                // If currencyId is missing, query it directly from database
                if (!pricing.currencyId && pricing.id) {
                    const pricingRawRes = await pricingMongooseCtr.findOne(
                        { id: pricing.id },
                        { currencyId: 1 }, // Only get currencyId
                    );
                    if (pricingRawRes.success && pricingRawRes.result?.currencyId) {
                        pricing.currencyId = pricingRawRes.result.currencyId;
                    }
                }
            }
            else {
                throwError({
                    status: RESPONSE_STATUS.NOT_FOUND,
                    message: `Pricing with id "${input.pricingId}" not found or is inactive`,
                });
            }
        }

        // Priority 1: by stateId (most specific)
        if (!pricing && stateId) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    type: E_PricingType.MEMBERSHIP,
                    stateId,
                    isActive: true,
                    isDel: false,
                },
                undefined,
                undefined,
                'currency',
            );
            if (pricingRes.success && pricingRes.result) {
                pricing = pricingRes.result;
                // Ensure currencyId is preserved even after populate
                if (!pricing.currencyId && pricing.id) {
                    const pricingRawRes = await pricingMongooseCtr.findOne(
                        { id: pricing.id },
                        { currencyId: 1 }, // Only get currencyId
                    );
                    if (pricingRawRes.success && pricingRawRes.result?.currencyId) {
                        pricing.currencyId = pricingRawRes.result.currencyId;
                    }
                }
            }
        }

        // Priority 2: by countryId (fallback)
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
                'currency',
            );
            if (pricingRes.success && pricingRes.result) {
                pricing = pricingRes.result;
                // Ensure currencyId is preserved even after populate
                if (!pricing.currencyId && pricing.id) {
                    const pricingRawRes = await pricingMongooseCtr.findOne(
                        { id: pricing.id },
                        { currencyId: 1 }, // Only get currencyId
                    );
                    if (pricingRawRes.success && pricingRawRes.result?.currencyId) {
                        pricing.currencyId = pricingRawRes.result.currencyId;
                    }
                }
            }
        }

        // Priority 3: default pricing (no country/state)
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
                'currency',
            );
            if (pricingRes.success && pricingRes.result) {
                pricing = pricingRes.result;
                // Ensure currencyId is preserved even after populate
                if (!pricing.currencyId && pricing.id) {
                    const pricingRawRes = await pricingMongooseCtr.findOne(
                        { id: pricing.id },
                        { currencyId: 1 }, // Only get currencyId
                    );
                    if (pricingRawRes.success && pricingRawRes.result?.currencyId) {
                        pricing.currencyId = pricingRawRes.result.currencyId;
                    }
                }
            }
        }

        if (!pricing) {
            throwError({
                status: RESPONSE_STATUS.NOT_FOUND,
                message: 'Pricing not found for your location',
            });
        }
        const pricingType = pricing.type ?? E_PricingType.MEMBERSHIP;

        // Validate that pricing has a valid currencyId
        if (!pricing.currencyId) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: `Pricing record (${pricing.id}) is missing currencyId. Please contact administrator to fix the pricing configuration.`,
            });
        }

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

        // Get currency code from pricing - MUST use the exact currency configured in pricing
        // We do NOT fallback to other currencies (EUR/USD) - must use the exact currencyId in pricing
        let currencyCode = pricing.currency?.code;

        // If currency is not populated, load it manually by currencyId from pricing
        // This ensures we use the exact currency configured in the pricing record
        if (!currencyCode && pricing.currencyId) {
            const currencyRes = await currencyCtr.getCurrency(context, {
                filter: {
                    id: pricing.currencyId,
                    isDel: false,
                },
            });

            if (currencyRes.success && 'result' in currencyRes && currencyRes.result) {
                currencyCode = currencyRes.result.code || currencyRes.result.symbol;
            }
            else {
                // Try to auto-fix: find a valid currency (prefer EUR, fallback to USD, or first available)
                const allCurrenciesRes = await currencyCtr.getCurrencies(context, {
                    filter: {},
                });

                let fixedCurrencyId: string | null = null;
                let fixedCurrencyCode: string | null = null;

                if (allCurrenciesRes.success && 'result' in allCurrenciesRes && allCurrenciesRes.result?.docs) {
                    // Prefer EUR, then USD, then first available
                    const eurCurrency = allCurrenciesRes.result.docs.find(c => c.code === 'EUR' && !c.isDel);
                    const usdCurrency = allCurrenciesRes.result.docs.find(c => c.code === 'USD' && !c.isDel);
                    const firstAvailableCurrency = allCurrenciesRes.result.docs.find(c => !c.isDel);

                    const selectedCurrency = eurCurrency || usdCurrency || firstAvailableCurrency;

                    if (selectedCurrency) {
                        fixedCurrencyId = selectedCurrency.id;
                        fixedCurrencyCode = selectedCurrency.code || selectedCurrency.symbol || null;

                        // Update pricing record with valid currencyId
                        try {
                            const updateResult = await pricingCtr.updatePricing(context, {
                                filter: { id: pricing.id },
                                update: {
                                    currencyId: fixedCurrencyId,
                                },
                            });

                            if (updateResult.success) {
                                // Update local pricing object
                                pricing.currencyId = fixedCurrencyId;
                                currencyCode = fixedCurrencyCode || undefined;
                            }
                        }
                        catch {
                            // Silent fail - will throw error below
                        }
                    }
                }

                // If auto-fix failed or no valid currency found, throw error
                if (!currencyCode) {
                    throwError({
                        status: RESPONSE_STATUS.BAD_REQUEST,
                        message: `Pricing record has invalid currencyId (${pricing.currencyId}). The currency does not exist. Please contact administrator to fix the pricing configuration.`,
                    });
                }
            }
        }

        // Currency must be present in pricing - no fallback allowed
        // We MUST use the exact currency configured in pricing, not a default currency
        if (!currencyCode) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: `Pricing record (${pricing.id}) is missing currency configuration. Please contact administrator to fix the pricing.`,
            });
        }

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
