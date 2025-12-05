import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Currency } from '#modules/location/currency/currency.type.js';
import type { I_Pricing } from '#modules/pricing/pricing.type.js';

export async function up(db: C_Db) {
    const pricingCtr = new MongoController<I_Pricing>(db, 'pricings');

    // Find all valid currencies
    const allCurrencies = await db.collection('currencies').find({
        isDel: false,
    }).toArray() as I_Currency[];

    if (!allCurrencies || allCurrencies.length === 0) {
        log.error('No valid currencies found. Cannot update pricing currencyId.');
        return;
    }

    // Create a Set of valid currency IDs for quick lookup
    const validCurrencyIds = new Set(
        allCurrencies.map((currency: I_Currency) => currency.id).filter(Boolean),
    );

    log.info(`Found ${validCurrencyIds.size} valid currencies: ${Array.from(validCurrencyIds).join(', ')}`);

    // Find EUR currency as default fallback
    const eurCurrency = allCurrencies.find((c: I_Currency) => c.code === 'EUR');
    const defaultCurrencyId = eurCurrency?.id || allCurrencies[0]?.id;

    if (!defaultCurrencyId) {
        log.error('No default currency found. Cannot update pricing currencyId.');
        return;
    }

    log.info(`Using default currency ID: ${defaultCurrencyId} (${eurCurrency?.code || 'first available'})`);

    // Find all pricings with currencyId
    const allPricings = await db.collection('pricings').find({
        isDel: false,
        currencyId: { $exists: true, $ne: null },
    }).toArray() as I_Pricing[];

    if (!allPricings || allPricings.length === 0) {
        log.info('No pricings found with currencyId.');
        return;
    }

    const pricingsToCheck = allPricings;
    log.info(`Checking ${pricingsToCheck.length} pricings for invalid currencyId...`);

    // Check each pricing and update if currencyId is invalid
    let updatedCount = 0;
    let skippedCount = 0;

    for (const pricing of pricingsToCheck) {
        if (!pricing.currencyId) {
            skippedCount++;
            continue;
        }

        // Check if currencyId exists in valid currencies
        if (validCurrencyIds.has(pricing.currencyId)) {
            skippedCount++;
            continue;
        }

        // CurrencyId is invalid, update to default
        log.warn(
            `Pricing ${pricing.id} has invalid currencyId: ${pricing.currencyId}. Updating to ${defaultCurrencyId}`,
        );

        const updateResult = await pricingCtr.updateOne(
            { id: pricing.id },
            { currencyId: defaultCurrencyId },
        );

        if (updateResult.success) {
            updatedCount++;
            log.info(`✓ Updated pricing ${pricing.id} from ${pricing.currencyId} to ${defaultCurrencyId}`);
        }
        else {
            log.error(`✗ Failed to update pricing ${pricing.id}`);
        }
    }

    log.success(
        `Migration completed: Updated ${updatedCount} pricings, ${skippedCount} were already valid.`,
    );
}

export async function down(db: C_Db) {
    const currencyCtr = new MongoController<I_Currency>(db, 'currencies');

    // Find EUR currency
    const eurCurrency = await currencyCtr.findOne({
        code: 'EUR',
        isDel: false,
    });

    if (!eurCurrency.success || !eurCurrency.result) {
        log.error('EUR currency not found. Cannot rollback pricing currencyId.');
        return;
    }

    const eurCurrencyId = eurCurrency.result.id;

    // Find all pricings with EUR currencyId that were updated
    // Note: This is a best-effort rollback. We'll revert to old ID if it exists,
    // otherwise we'll leave them as is since we can't determine which ones were updated.
    const pricingsWithEurCurrency = await db.collection('pricings').find({
        currencyId: eurCurrencyId,
        isDel: false,
    }).toArray();

    if (!pricingsWithEurCurrency || pricingsWithEurCurrency.length === 0) {
        log.info('No pricings found with EUR currencyId to rollback.');
        return;
    }

    log.warn(
        `Rollback: Found ${pricingsWithEurCurrency.length} pricings with EUR currencyId. `
        + 'Cannot automatically determine which pricings to revert. '
        + 'Old currency ID no longer exists. Manual intervention may be required.',
    );
}
