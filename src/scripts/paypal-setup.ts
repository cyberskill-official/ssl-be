import { log } from '@cyberskill/shared/node/log';
import mongoose from 'mongoose';

import { paypalCtr } from '../modules/payment/paypal/paypal.controller.js';
import {
    E_PayPalIntervalUnit,
    E_PayPalProductCategory,
    E_PayPalProductType,
    E_PayPalTenureType,
} from '../modules/payment/paypal/paypal.type.js';
import { PricingModel } from '../modules/pricing/pricing.model.js';
import { E_PricingType } from '../modules/pricing/pricing.type.js';
import { getEnv } from '../shared/env/index.js';

/**
 * AUTOMATED PAYPAL SETUP SCRIPT
 *
 * This script will:
 * 1. Create a Product on PayPal (if it doesn't exist).
 * 2. Create a Subscription Plan for your Membership.
 * 3. Update all your Membership pricing records in MongoDB with the new Plan ID.
 */

async function run() {
    const env = getEnv();

    log.info('Connecting to MongoDB...');
    await mongoose.connect(env.MONGO_URI);
    log.success('Connected to MongoDB');

    try {
        // 1. Create Product
        log.info('Step 1: Creating PayPal Product...');
        const productRes = await paypalCtr.createProduct({} as any, {
            name: 'SSL Membership',
            description: 'Secret® Swinger Lust Membership Subscription',
            type: E_PayPalProductType.SERVICE,
            category: E_PayPalProductCategory.SOFTWARE,
        });

        if (!productRes.success || !productRes.result) {
            throw new Error(`Failed to create product: ${productRes.message}`);
        }

        const productId = productRes.result.id;
        log.success(`Product created successfully: ${productId}`);

        // 2. Create Plan
        log.info('Step 2: Creating PayPal Subscription Plan...');
        // Default to 5.50 EUR monthly as seen in your screenshot
        const planRes = await paypalCtr.createPlan({} as any, {
            product_id: productId,
            name: 'Monthly Membership',
            description: 'Monthly unlimited access to SSL',
            billing_cycles: [
                {
                    frequency: {
                        interval_unit: E_PayPalIntervalUnit.MONTH,
                        interval_count: 1,
                    },
                    tenure_type: E_PayPalTenureType.REGULAR,
                    sequence: 1,
                    total_cycles: 0, // Infinite
                    pricing_scheme: {
                        fixed_price: {
                            value: '5.50',
                            currency_code: 'EUR',
                        },
                    },
                },
            ],
            payment_preferences: {
                auto_bill_outstanding: true,
                payment_failure_threshold: 3,
            },
        });

        if (!planRes.success || !planRes.result) {
            throw new Error(`Failed to create plan: ${planRes.message}`);
        }

        const planId = planRes.result.id;
        log.success(`Plan created successfully: ${planId}`);

        // 3. Update Database
        log.info('Step 3: Updating Membership pricing in database...');
        const updateResult = await PricingModel.updateMany(
            {
                type: E_PricingType.MEMBERSHIP,
                isActive: true,
            },
            {
                $set: { paypalPlanId: planId },
            },
        );

        log.success(`Successfully updated ${updateResult.modifiedCount} records with Plan ID: ${planId}`);
    }
    catch (error: any) {
        log.error('Setup failed:', error.message);
    }
    finally {
        await mongoose.disconnect();
        log.info('Disconnected from MongoDB');
    }
}

run();
