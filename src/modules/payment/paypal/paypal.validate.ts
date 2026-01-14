import type { I_PayPalBillingCycle } from './paypal.type.js';

import { E_PayPalTenureType } from './paypal.type.js';

const MAX_BILLING_CYCLES = 12;
const MAX_TRIAL_CYCLES = 2;
const MAX_REGULAR_CYCLES = 1;
const TRIAL_TENURES = new Set<I_PayPalBillingCycle['tenure_type']>([E_PayPalTenureType.TRIAL, E_PayPalTenureType.TRIAL_PERIOD]);

export function getBillingCyclesValidationError(cycles?: I_PayPalBillingCycle[]): string | null {
    if (!Array.isArray(cycles)) {
        return 'billing_cycles is required and must be an array of billing cycle definitions';
    }

    if (cycles.length < 1 || cycles.length > MAX_BILLING_CYCLES) {
        return `billing_cycles must contain between 1 and ${MAX_BILLING_CYCLES} items`;
    }

    const trialCount = cycles.filter(cycle => TRIAL_TENURES.has(cycle.tenure_type)).length;
    if (trialCount > MAX_TRIAL_CYCLES) {
        return 'A plan can have at most two trial billing cycles';
    }

    const regularCount = cycles.filter(cycle => cycle.tenure_type === 'REGULAR').length;
    if (regularCount > MAX_REGULAR_CYCLES) {
        return 'A plan can have at most one regular billing cycle';
    }

    return null;
}
