import type { I_Pricing } from './pricing.type.js';

/**
 * Calculate final amount (price + tax) from pricing
 * @param pricing - Pricing object with price and taxRate
 * @returns Final amount with tax included, rounded to 2 decimal places
 */
export function calculateAmountFromPricing(pricing: I_Pricing | null | undefined): number {
    if (!pricing) {
        return 0;
    }

    const baseAmount = typeof pricing.price === 'number' ? pricing.price : 0;
    const taxRate = typeof pricing.taxRate === 'number' ? pricing.taxRate : 0;

    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
        return 0;
    }

    const taxPortion = baseAmount * (taxRate / 100);
    const finalAmount = Number((baseAmount + taxPortion).toFixed(2));

    return finalAmount;
}
