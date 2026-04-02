import { log } from '@cyberskill/shared/node/log';

import type { I_Context } from '#shared/typescript/index.js';

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

export const paypalSetupService = {
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
            description: 'Secret Swinger Lust Membership Subscription',
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
        const planName = `Monthly Membership ${targetPrice} ${currency}`;

        // 1. Try to find existing plan under this product
        const listRes = await paypalCtr.listPlans(context, { productId });
        if (listRes.success && listRes.result?.plans) {
            const existing = listRes.result.plans.find((p) => {
                const cycle = p.billing_cycles?.[0];
                return cycle?.pricing_scheme?.fixed_price?.value === targetPrice
                    && cycle?.pricing_scheme?.fixed_price?.currency_code === currency
                    && p.status === 'ACTIVE';
            });

            if (existing) {
                log.info(`[PayPal Setup] Found existing plan: ${existing.id}`);
                return { id: existing.id };
            }
        }

        // 2. Create if not found
        log.info(`[PayPal Setup] Plan "${planName}" not found, creating...`);
        const createRes = await paypalCtr.createPlan(context, {
            product_id: productId,
            name: planName,
            description: `Monthly membership at ${targetPrice} ${currency}`,
            billing_cycles: [
                {
                    frequency: {
                        interval_unit: E_PayPalIntervalUnit.MONTH,
                        interval_count: 1,
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
};
