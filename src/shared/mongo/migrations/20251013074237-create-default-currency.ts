import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';

import type { I_Currency, I_Input_CreateCurrency } from '#modules/location/currency/currency.type.js';

interface I_CurrenciesRaw extends I_Input_CreateCurrency {
}
const defaultCurrencies: I_CurrenciesRaw[] = [
    {
        name: 'Euro',
        code: 'EUR',
        symbol: '€',
    },
    {
        name: 'United States Dollar',
        code: 'USD',
        symbol: '$',
    },
];

export async function up(db: C_Db) {
    const currencyCtr = new MongoController<I_Currency>(db, 'currencies');

    const filteredTemplates = await mongo.getNewRecords(
        currencyCtr,
        defaultCurrencies as I_Currency[],
        (existingTemplate, newTemplate) =>
            existingTemplate.name === newTemplate.name,
    );

    if (filteredTemplates.length === 0) {
        log.info('No new currency to create. All currencies already exist.');
        return;
    }

    const emailTplsCreated = await currencyCtr.createMany(filteredTemplates);

    if (!emailTplsCreated.success) {
        log.error('Failed to create some currencies.');
        return;
    }

    log.success(`Successfully created ${filteredTemplates.length} new currencies.`);
}

export async function down(db: C_Db) {
    const currencyCtr = new MongoController<I_Currency>(
        db,
        'currencies',
    );

    const templatesToDelete = defaultCurrencies.map(template => ({ name: template.name }));

    const existingTemplates = await mongo.getExistingRecords(
        currencyCtr,
        templatesToDelete as I_Currency[],
        (existingTemplate, deleteTemplate) =>
            existingTemplate.name === deleteTemplate.name,
    );

    if (existingTemplates.length === 0) {
        log.info('No currencie to delete. No matching curencies found.');
        return;
    }

    const deletedTemplates = await currencyCtr.deleteMany({
        id: { $in: existingTemplates.map(template => template.id) },
    });

    if (!deletedTemplates.success) {
        log.error('Failed to delete currencies.');
        return;
    }

    log.success(`Successfully deleted ${existingTemplates.length} currencies.`);
}
