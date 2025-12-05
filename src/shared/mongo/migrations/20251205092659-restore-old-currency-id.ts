import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Currency } from '#modules/location/currency/currency.type.js';

// Old currency ID to restore
const OLD_CURRENCY_ID = 'e7c9d5dc-a1d2-4317-ae8e-b93f338944b6';

// Currency details - adjust these based on what the old currency was
// Assuming it was EUR based on common usage
const OLD_CURRENCY_DETAILS: I_Currency = {
    id: OLD_CURRENCY_ID,
    name: 'Euro',
    code: 'EUR',
    symbol: '€',
    isDel: false,
} as I_Currency;

export async function up(db: C_Db) {
    const currencyCtr = new MongoController<I_Currency>(db, 'currencies');

    // Check if old currency already exists
    const existingCurrency = await currencyCtr.findOne({
        id: OLD_CURRENCY_ID,
    });

    if (existingCurrency.success && existingCurrency.result) {
        log.info('Old currency ID already exists. No need to create.');
        return;
    }

    // Check if currency with same code exists (to avoid duplicates)
    const currencyByCode = await currencyCtr.findOne({
        code: OLD_CURRENCY_DETAILS.code,
        isDel: false,
    });

    if (currencyByCode.success && currencyByCode.result) {
        log.warn(
            `Currency with code ${OLD_CURRENCY_DETAILS.code} already exists with ID: ${currencyByCode.result.id}. `
            + 'Consider using the fix-pricing-currency-id migration instead.',
        );
        return;
    }

    // Create currency with old ID using direct MongoDB insert
    // Note: We need to use direct collection access to set a specific _id
    try {
        const collection = db.collection('currencies');
        const now = new Date();

        await collection.insertOne({
            _id: OLD_CURRENCY_ID as unknown as never,
            id: OLD_CURRENCY_ID,
            name: OLD_CURRENCY_DETAILS.name,
            code: OLD_CURRENCY_DETAILS.code,
            symbol: OLD_CURRENCY_DETAILS.symbol,
            isDel: false,
            createdAt: now,
            updatedAt: now,
        } as never);

        log.success(`Successfully created currency with old ID: ${OLD_CURRENCY_ID}`);
    }
    catch (error) {
        log.error(`Failed to create currency with old ID: ${error}`);
        throw error;
    }
}

export async function down(db: C_Db) {
    const currencyCtr = new MongoController<I_Currency>(db, 'currencies');

    // Delete the old currency
    const deleteResult = await currencyCtr.deleteOne({
        id: OLD_CURRENCY_ID,
    });

    if (deleteResult.success) {
        log.success(`Successfully deleted currency with old ID: ${OLD_CURRENCY_ID}`);
    }
    else {
        log.warn(`Currency with old ID may not exist or already deleted: ${OLD_CURRENCY_ID}`);
    }
}
