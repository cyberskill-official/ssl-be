import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Input_CreateOrder } from '#modules/order/order.type.js';
import type { I_PayPalCreateOrderPayload, I_PayPalCreateOrderResponse, I_PayPalSubscriptionResponse } from '#modules/payment/paypal/paypal.type.js';
import type { I_Pricing } from '#modules/pricing/pricing.type.js';
import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { countryCtr } from '#modules/location/country/country.controller.js';
import { currencyCtr } from '#modules/location/currency/index.js';
import { stateCtr } from '#modules/location/state/state.controller.js';
import orderCtr from '#modules/order/order.controller.js';
import { E_OrderStatus, E_OrderType } from '#modules/order/order.type.js';
import { paymentRequestCtr } from '#modules/payment/payment-request/index.js';
import { E_PaymentRequestStatus } from '#modules/payment/payment-request/payment-request.type.js';
import { E_PaymentProvider } from '#modules/payment/payment-transaction/payment-transaction.type.js';
import { paypalCtr } from '#modules/payment/paypal/paypal.controller.js';
import { ensurePayPalCredentials } from '#modules/payment/paypal/paypal.handler.js';
import { paypalSetupService } from '#modules/payment/paypal/paypal.setup.service.js';
import { E_PayPalIntent, E_PayPalLandingPage, E_PayPalShippingPreference, E_PayPalUserAction } from '#modules/payment/paypal/paypal.type.js';
import { calculateAmountFromPricing, pricingCtr } from '#modules/pricing/index.js';
import { PricingModel } from '#modules/pricing/pricing.model.js';
import { E_PricingType } from '#modules/pricing/pricing.type.js';

import type { I_Input_MakePayment, I_MakePaymentResult } from './payment.type.js';

import { getPaymentRedirectBase } from './payment.handler.js';
import { E_PaymentMethod, E_PaymentStatus } from './payment.type.js';

const pricingMongooseCtr = new MongooseController<I_Pricing>(PricingModel);

function appendQueryParams(url: string, params: Record<string, string>) {
    const query = new URLSearchParams(params).toString();
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${query}`;
}

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

        // Cleanup stale in-progress orders older than 10 minutes (best-effort)
        try {
            const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
            await orderCtr.deleteOrders(context, {
                filter: {
                    userId: currentUser.id,
                    status: { $in: [E_OrderStatus.CREATED, E_OrderStatus.PENDING] } as any,
                    createdAt: { $lt: staleThreshold } as any,
                },
            } as any);
        }
        catch {
            // non-fatal cleanup
        }

        // Rate-limit: block creating a new payment if there's an in-progress order in the last 10 minutes
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        const recentOrderRes = await orderCtr.getOrders(context, {
            filter: {
                userId: currentUser.id,
                status: { $in: [E_OrderStatus.CREATED, E_OrderStatus.PENDING] } as any,
                createdAt: { $gte: tenMinutesAgo } as any,
            },
            options: { pagination: false, sort: { createdAt: -1 } },
        } as any);

        if (recentOrderRes.success && recentOrderRes.result?.docs?.length > 0) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'You have a payment in progress. Please wait 10 minutes before starting a new payment.',
            });
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

        // Determine pricing type based on input
        // If event is provided, it's for ANNOUNCEMENT, otherwise MEMBERSHIP
        const expectedPricingType = input.event ? E_PricingType.ANNOUNCEMENT : E_PricingType.MEMBERSHIP;

        // Find pricing - ensure currency is populated
        // Use string format 'currency' to match how it's used elsewhere in the system
        let pricing: I_Pricing | undefined;

        // Priority 0: If pricingId is provided, use that pricing directly
        if (input.pricingId) {
            // Then query with filters (use expected type, but also allow any type if pricingId is provided)
            // First try with expected type
            let pricingRes = await pricingMongooseCtr.findOne(
                {
                    id: input.pricingId,
                    type: expectedPricingType,
                    isActive: true,
                    isDel: false,
                },
                undefined,
                undefined,
                'currency',
            );

            // If not found with expected type, try without type filter (pricingId should be unique)
            if (!pricingRes.success || !pricingRes.result) {
                pricingRes = await pricingMongooseCtr.findOne(
                    {
                        id: input.pricingId,
                        isActive: true,
                        isDel: false,
                    },
                    undefined,
                    undefined,
                    'currency',
                );
            }
            if (pricingRes.success && pricingRes.result) {
                const foundPricing = pricingRes.result;
                // Validate that pricing matches current location
                // If pricing has stateId, it must match current stateId
                // If pricing has countryId (but no stateId), it must match current countryId
                // If pricing has neither, it's a default pricing and can be used
                const pricingStateId = foundPricing.stateId;
                const pricingCountryId = foundPricing.countryId;
                let pricingMatchesLocation = true;

                if (pricingStateId) {
                    // Pricing is state-specific, must match current stateId
                    pricingMatchesLocation = stateId === pricingStateId;
                }
                else if (pricingCountryId) {
                    // Pricing is country-specific, must match current countryId
                    pricingMatchesLocation = countryId === pricingCountryId;
                }
                // If pricing has neither stateId nor countryId, it's default and matches any location

                if (pricingMatchesLocation) {
                    pricing = foundPricing;
                    // Ensure currencyId is preserved even after populate
                    // If currencyId is missing, query it directly from database
                    if (!pricing.currencyId && pricing.id) {
                        const pricingRawRes = await pricingMongooseCtr.findOne(
                            { id: pricing.id },
                            { currencyId: 1 }, // Only get currencyId
                        );

                        if (pricingRawRes.success && 'result' in pricingRawRes && pricingRawRes.result?.currencyId) {
                            pricing.currencyId = pricingRawRes.result.currencyId;
                        }
                    }
                }
                else {
                    // Don't use this pricing, fallback to location-based search below
                    // pricing will remain undefined
                }
            }
            else {
                // Don't throw error, fallback to location-based pricing search below
                // pricing will remain undefined and we'll search by location
            }
        }

        // Priority 1: by stateId (most specific)
        if (!pricing && stateId) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    type: expectedPricingType,
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
                    if (pricingRawRes.success && 'result' in pricingRawRes && pricingRawRes.result?.currencyId) {
                        pricing.currencyId = pricingRawRes.result.currencyId;
                    }
                }
            }
        }

        // Priority 2: by countryId (fallback)
        if (!pricing && countryId) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    type: expectedPricingType,
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
                    if (pricingRawRes.success && 'result' in pricingRawRes && pricingRawRes.result?.currencyId) {
                        pricing.currencyId = pricingRawRes.result.currencyId;
                    }
                }
            }
        }

        // Priority 3: default pricing (no country/state)
        if (!pricing) {
            const pricingRes = await pricingMongooseCtr.findOne(
                {
                    type: expectedPricingType,
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
                    if (pricingRawRes.success && 'result' in pricingRawRes && pricingRawRes.result?.currencyId) {
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
            // Try to auto-fix missing currencyId by selecting a valid currency
            const allCurrenciesRes = await currencyCtr.getCurrencies(context, { filter: {} });
            if (allCurrenciesRes.success && 'result' in allCurrenciesRes && allCurrenciesRes.result?.docs?.length) {
                const eurCurrency = allCurrenciesRes.result.docs.find(c => c.code === 'EUR' && !c.isDel);
                const usdCurrency = allCurrenciesRes.result.docs.find(c => c.code === 'USD' && !c.isDel);
                const firstAvailableCurrency = allCurrenciesRes.result.docs.find(c => !c.isDel);
                const selected = eurCurrency || usdCurrency || firstAvailableCurrency;
                if (selected) {
                    await pricingCtr.updatePricing(context, {
                        filter: { id: pricing.id },
                        update: { currencyId: selected.id },
                    }).catch(() => { /* best-effort */ });
                    pricing.currencyId = selected.id;
                    pricing.currency = selected as any;
                }
            }

            if (!pricing.currencyId) {
                throwError({
                    status: RESPONSE_STATUS.BAD_REQUEST,
                    message: `Pricing record (${pricing.id}) is missing currencyId. Please contact administrator to fix the pricing configuration.`,
                });
            }
        }

        // Calculate amount from pricing (price + tax)
        const resolvedAmount = calculateAmountFromPricing(pricing);

        if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
            throwError({
                status: RESPONSE_STATUS.BAD_REQUEST,
                message: 'Pricing amount is invalid',
            });
        }

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

        // userId is automatically set from currentUser (BE), not from FE input
        // Determine orderType based on pricingType: MEMBERSHIP = SUBSCRIPTION, ANNOUNCEMENT = A_LA_CARTE_EVENT
        const orderType = pricingType === E_PricingType.MEMBERSHIP
            ? E_OrderType.SUBSCRIPTION
            : E_OrderType.A_LA_CARTE_EVENT;

        const requestedProvider = input.paymentProvider;
        const paymentProvider = E_PaymentProvider.PAYPAL;

        if (requestedProvider && requestedProvider !== E_PaymentProvider.PAYPAL) {
            log.warn('[Payment] Non-PayPal provider requested; forcing PayPal for compatibility', {
                requestedProvider,
                userId: currentUser.id,
                pricingType,
            });
        }

        const orderDoc: I_Input_CreateOrder = {
            userId: currentUser.id, // BE automatically sets userId from session
            amount: resolvedAmount,
            pricingId: pricing.id, // From auto-detected pricing
            orderType, // SUBSCRIPTION or A_LA_CARTE_EVENT
            ...(input.event ? { meta: { event: input.event } } : {}),
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

        const prDoc = {
            gateway: paymentProvider,
            status: E_PaymentRequestStatus.WAITING,
            attempts: 0,
            meta: {
                orderId: createdOrder.id,
                amount: resolvedAmount,
                currencyId: pricing.currencyId,
                pricingId: pricing.id,
                pricingType,
                paymentProvider,
            },
        };
        const prRes = await paymentRequestCtr.createPaymentRequest(context, { doc: prDoc });
        if (!prRes.success || !prRes.result) {
            throwError({ status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR, message: 'Failed to create payment request' });
        }
        const paymentRequest = prRes.result;

        if (paymentProvider === E_PaymentProvider.PAYPAL) {
            const redirectBase = getPaymentRedirectBase();
            const returnUrl = appendQueryParams(redirectBase, {
                status: 'PENDING',
                provider: E_PaymentProvider.PAYPAL,
            });
            const cancelUrl = appendQueryParams(redirectBase, {
                status: 'CANCEL',
                provider: E_PaymentProvider.PAYPAL,
            });

            let paypalResponse: I_Return<I_PayPalCreateOrderResponse | I_PayPalSubscriptionResponse>;
            let externalOrderId: string | undefined;
            let approvalUrl: string | undefined;
            let gatewayResponse: any;

            if (pricingType === E_PricingType.MEMBERSHIP) {
                let paypalPlanId = pricing.paypalPlanId;

                // Dynamic/Lazy Setup: If Plan ID is missing, create it on-the-fly
                if (!paypalPlanId) {
                    log.info(`[Payment] Membership pricing ${pricing.id} is missing PayPal Plan ID. Initializing dynamic setup...`);

                    const productSetup = await paypalSetupService.getOrCreateProduct(context);
                    if (!productSetup.id) {
                        throwError({
                            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                            message: `Failed to initialize PayPal product for subscription${productSetup.error ? `: ${productSetup.error}` : ''}`,
                        });
                    }

                    const planSetup = await paypalSetupService.getOrCreatePlan(
                        context,
                        productSetup.id,
                        resolvedAmount,
                        currencyCode,
                    );
                    if (!planSetup.id) {
                        throwError({
                            status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                            message: `Failed to initialize PayPal plan for subscription${planSetup.error ? `: ${planSetup.error}` : ''}`,
                        });
                    }

                    paypalPlanId = planSetup.id;

                    // Update the pricing record in DB so we don't have to create it again
                    await PricingModel.updateOne(
                        { _id: pricing._id ?? pricing.id },
                        { $set: { paypalPlanId } },
                    );
                    log.success(`[Payment] Dynamically created and linked PayPal Plan ${paypalPlanId} to pricing ${pricing.id}`);
                }

                const subscriptionPayload = {
                    plan_id: paypalPlanId,
                    custom_id: currentUser.id,
                    application_context: {
                        return_url: returnUrl,
                        cancel_url: cancelUrl,
                        landing_page: E_PayPalLandingPage.BILLING,
                        user_action: E_PayPalUserAction.SUBSCRIBE_NOW,
                        shipping_preference: E_PayPalShippingPreference.NO_SHIPPING,
                    },
                };

                const subResponse = await paypalCtr.createSubscription(context, subscriptionPayload);
                paypalResponse = subResponse as any;
                if (subResponse.success && subResponse.result) {
                    externalOrderId = subResponse.result.id;
                    approvalUrl = subResponse.result.links?.find(l => l.rel === 'approve')?.href;
                    gatewayResponse = subResponse.result;
                }
            }
            else {
                const orderPayload: I_PayPalCreateOrderPayload = {
                    intent: E_PayPalIntent.CAPTURE,
                    purchase_units: [
                        {
                            amount: {
                                currency_code: currencyCode,
                                value: resolvedAmount.toFixed(2),
                            },
                            description: 'Event Announcement',
                        },
                    ],
                    application_context: {
                        return_url: returnUrl,
                        cancel_url: cancelUrl,
                        user_action: E_PayPalUserAction.PAY_NOW,
                        shipping_preference: E_PayPalShippingPreference.NO_SHIPPING,
                    },
                };

                const ordResponse = await paypalCtr.createOrder(context, orderPayload);
                paypalResponse = ordResponse;
                if (ordResponse.success && ordResponse.result) {
                    externalOrderId = ordResponse.result.id;
                    approvalUrl = ordResponse.result.links?.find(
                        link => link.rel === 'approve' || link.rel === 'payer-action',
                    )?.href;
                    gatewayResponse = ordResponse.result;
                }
            }

            if (!paypalResponse.success || !gatewayResponse || !approvalUrl || !externalOrderId) {
                throwError({
                    status: RESPONSE_STATUS.BAD_REQUEST,
                    message: paypalResponse.message ?? 'Failed to initiate PayPal payment',
                });
            }

            // Extract token from approvalUrl for easier lookup later
            let token: string | undefined;
            if (approvalUrl) {
                try {
                    const url = new URL(approvalUrl);
                    token = url.searchParams.get('token') || url.searchParams.get('ba_token') || undefined;
                }
                catch {
                    // ignore
                }
            }

            await paymentRequestCtr.updatePaymentRequest(context, {
                filter: { id: paymentRequest.id },
                update: {
                    $set: {
                        'status': E_PaymentRequestStatus.PENDING,
                        'paymentUrl': approvalUrl ?? null,
                        externalOrderId,
                        gatewayResponse,
                        'attempts': (paymentRequest.attempts ?? 0) + 1,
                        'meta.token': token,
                    },
                },
            });

            await orderCtr.updateOrder(context, {
                filter: { id: createdOrder.id },
                update: {
                    $set: {
                        status: E_OrderStatus.PENDING,
                        externalOrderId,
                    },
                },
            });

            const { credentials } = ensurePayPalCredentials();
            const clientTokenRes = await paypalCtr.generateClientToken(context);
            const clientToken = clientTokenRes.success ? clientTokenRes.result?.client_token : null;

            const paymentResult: I_MakePaymentResult = {
                orderId: createdOrder.id,
                amount: resolvedAmount,
                currencyCode,
                paymentMethod: E_PaymentMethod.WALLET,
                paymentStatus: E_PaymentStatus.PENDING,
                pricingId: pricing.id,
                redirectUrl: approvalUrl,
                clientToken,
                paypalOrderId: externalOrderId,
                paypalClientId: credentials?.clientId,
                isSubscription: pricingType === E_PricingType.MEMBERSHIP,
            };

            return {
                success: true,
                message: paypalResponse.message ?? 'PayPal payment initiated',
                result: paymentResult,
            };
        }

        return null as any;
    },
};

export default paymentController;
