import { log } from '@cyberskill/shared/node/log';
import { addDays, addMonths, addWeeks, addYears } from 'date-fns';

import type { I_Context } from '#shared/typescript/index.js';

import { getEnv } from '#shared/env/index.js';

import { paypalCtr } from './paypal.controller.js';
import {
    E_PayPalIntervalUnit,
    E_PayPalProductCategory,
    E_PayPalProductType,
    E_PayPalTenureType,
} from './paypal.type.js';

interface I_PayPalSetupResult {
    id: string | null;
    error?: string;
}

export interface I_PayPalSubscriptionBillingCycle {
    intervalUnit: E_PayPalIntervalUnit;
    intervalCount: number;
}

const env = getEnv();

function getConfiguredBillingCycle(): I_PayPalSubscriptionBillingCycle {
    const intervalUnit = env.PAYPAL_SUBSCRIPTION_INTERVAL_UNIT as E_PayPalIntervalUnit;
    const intervalCount = Math.max(1, Math.floor(env.PAYPAL_SUBSCRIPTION_INTERVAL_COUNT));

    return {
        intervalUnit,
        intervalCount,
    };
}

function getBillingCycleLabel({ intervalUnit, intervalCount }: I_PayPalSubscriptionBillingCycle): string {
    if (intervalCount === 1) {
        switch (intervalUnit) {
            case E_PayPalIntervalUnit.DAY:
                return 'Daily';
            case E_PayPalIntervalUnit.WEEK:
                return 'Weekly';
            case E_PayPalIntervalUnit.MONTH:
                return 'Monthly';
            case E_PayPalIntervalUnit.YEAR:
                return 'Yearly';
        }
    }

    return `Every ${intervalCount} ${intervalUnit.toLowerCase()}s`;
}

function addConfiguredBillingCycle(baseDate: Date): Date {
    const { intervalUnit, intervalCount } = getConfiguredBillingCycle();

    switch (intervalUnit) {
        case E_PayPalIntervalUnit.DAY:
            return addDays(baseDate, intervalCount);
        case E_PayPalIntervalUnit.WEEK:
            return addWeeks(baseDate, intervalCount);
        case E_PayPalIntervalUnit.MONTH:
            return addMonths(baseDate, intervalCount);
        case E_PayPalIntervalUnit.YEAR:
            return addYears(baseDate, intervalCount);
    }
}

export const paypalSetupService = {
    getConfiguredBillingCycle,
    addConfiguredBillingCycle,

    isDefaultBillingCycle(): boolean {
        const cycle = getConfiguredBillingCycle();
        return cycle.intervalUnit === E_PayPalIntervalUnit.MONTH && cycle.intervalCount === 1;
    },

    /**
     * Finds or creates a standard Membership product on PayPal
     */
    async getOrCreateProduct(context: I_Context): Promise<I_PayPalSetupResult> {
        const productName = 'SSL Membership';

        // 1. Try to find existing
        const listRes = await paypalCtr.listProducts(context);
        if (listRes.success && listRes.result?.products) {
            const existing = listRes.result.products.find(p => p.name === productName);
            if (existing) {
                log.info(`[PayPal Setup] Found existing product: ${existing.id}`);
                return { id: existing.id };
            }
        }

        // 2. Create if not found
        log.info(`[PayPal Setup] Product "${productName}" not found, creating...`);
        const createRes = await paypalCtr.createProduct(context, {
            name: productName,
            description: 'Secret® Swinger Lust Membership Subscription',
            type: E_PayPalProductType.SERVICE,
            category: E_PayPalProductCategory.SOFTWARE,
        });

        if (createRes.success && createRes.result) {
            log.success(`[PayPal Setup] Product created: ${createRes.result.id}`);
            return { id: createRes.result.id };
        }

        log.error(`[PayPal Setup] Failed to get or create product: ${createRes.message}`);
        return {
            id: null,
            error: createRes.message ?? listRes.message ?? 'Unknown PayPal product setup error',
        };
    },

    /**
     * Finds or creates a subscription plan matching price and currency
     */
    async getOrCreatePlan(
        context: I_Context,
        productId: string,
        price: number,
        currency: string,
    ): Promise<I_PayPalSetupResult> {
        const targetPrice = price.toFixed(2);
        const billingCycle = getConfiguredBillingCycle();
        const billingCycleLabel = getBillingCycleLabel(billingCycle);
        const planName = `${billingCycleLabel} Membership ${targetPrice} ${currency}`;

        // 1. Try to find existing plan under this product
        const listRes = await paypalCtr.listPlans(context, { productId });
        if (listRes.success && listRes.result?.plans) {
            const existing = listRes.result.plans.find((p) => {
                const cycle = p.billing_cycles?.[0];
                return cycle?.pricing_scheme?.fixed_price?.value === targetPrice
                    && cycle?.pricing_scheme?.fixed_price?.currency_code === currency
                    && cycle?.frequency?.interval_unit === billingCycle.intervalUnit
                    && cycle?.frequency?.interval_count === billingCycle.intervalCount
                    && p.status === 'ACTIVE';
            });

            if (existing) {
                log.info(`[PayPal Setup] Found existing monthly plan: ${existing.id}`);
                return { id: existing.id };
            }
        }

        // 2. Create if not found
        log.info(`[PayPal Setup] ${billingCycleLabel} plan "${planName}" not found, creating...`);
        const createRes = await paypalCtr.createPlan(context, {
            product_id: productId,
            name: planName,
            description: `${billingCycleLabel} membership at ${targetPrice} ${currency}`,
            billing_cycles: [
                {
                    frequency: {
                        interval_unit: billingCycle.intervalUnit,
                        interval_count: billingCycle.intervalCount,
                    },
                    tenure_type: E_PayPalTenureType.REGULAR,
                    sequence: 1,
                    total_cycles: 0,
                    pricing_scheme: {
                        fixed_price: {
                            value: targetPrice,
                            currency_code: currency,
                        },
                    },
                },
            ],
            payment_preferences: {
                auto_bill_outstanding: true,
                payment_failure_threshold: 3,
            },
        });

        if (createRes.success && createRes.result) {
            log.success(`[PayPal Setup] Plan created: ${createRes.result.id}`);
            // Note: Plan is created as ACTIVE by default in v1/billing/plans
            return { id: createRes.result.id };
        }

        log.error(`[PayPal Setup] Failed to get or create plan: ${createRes.message}`);
        return {
            id: null,
            error: createRes.message ?? listRes.message ?? 'Unknown PayPal plan setup error',
        };
    },

    /**
     * Top-up replacement plan: charge one period immediately via setup_fee,
     * then start recurring billing at the subscription start_time.
     */
    async getOrCreateTopUpPlan(
        context: I_Context,
        productId: string,
        price: number,
        currency: string,
    ): Promise<I_PayPalSetupResult> {
        const targetPrice = price.toFixed(2);
        const billingCycle = getConfiguredBillingCycle();
        const billingCycleLabel = getBillingCycleLabel(billingCycle);
        const planName = `${billingCycleLabel} Membership Top-up ${targetPrice} ${currency}`;

        const listRes = await paypalCtr.listPlans(context, { productId });
        if (listRes.success && listRes.result?.plans) {
            const existing = listRes.result.plans.find((p) => {
                const cycle = p.billing_cycles?.[0];
                return p.name === planName
                    && cycle?.pricing_scheme?.fixed_price?.value === targetPrice
                    && cycle?.pricing_scheme?.fixed_price?.currency_code === currency
                    && cycle?.frequency?.interval_unit === billingCycle.intervalUnit
                    && cycle?.frequency?.interval_count === billingCycle.intervalCount
                    && p.payment_preferences?.setup_fee?.value === targetPrice
                    && p.payment_preferences?.setup_fee?.currency_code === currency
                    && p.status === 'ACTIVE';
            });

            if (existing) {
                log.info(`[PayPal Setup] Found existing monthly top-up plan: ${existing.id}`);
                return { id: existing.id };
            }
        }

        log.info(`[PayPal Setup] ${billingCycleLabel} top-up plan "${planName}" not found, creating...`);
        const createRes = await paypalCtr.createPlan(context, {
            product_id: productId,
            name: planName,
            description: `${billingCycleLabel} membership top-up at ${targetPrice} ${currency}; setup fee charges the added period immediately`,
            billing_cycles: [
                {
                    frequency: {
                        interval_unit: billingCycle.intervalUnit,
                        interval_count: billingCycle.intervalCount,
                    },
                    tenure_type: E_PayPalTenureType.REGULAR,
                    sequence: 1,
                    total_cycles: 0,
                    pricing_scheme: {
                        fixed_price: {
                            value: targetPrice,
                            currency_code: currency,
                        },
                    },
                },
            ],
            payment_preferences: {
                auto_bill_outstanding: true,
                setup_fee: {
                    value: targetPrice,
                    currency_code: currency,
                },
                payment_failure_threshold: 3,
            },
        });

        if (createRes.success && createRes.result) {
            log.success(`[PayPal Setup] Top-up plan created: ${createRes.result.id}`);
            return { id: createRes.result.id };
        }

        log.error(`[PayPal Setup] Failed to get or create top-up plan: ${createRes.message}`);
        return {
            id: null,
            error: createRes.message ?? listRes.message ?? 'Unknown PayPal top-up plan setup error',
        };
    },
};
