import type { C_Db } from '@cyberskill/shared/node/mongo';

import { log } from '@cyberskill/shared/node/log';
import { mongo, MongoController } from '@cyberskill/shared/node/mongo';
import { continents, countries, languages } from 'countries-list';

import type { I_Country } from '#modules/country/index.js';

export async function up(db: C_Db) {
    const countryCtr = new MongoController<I_Country>(db, 'countries');

    const entries = Object.entries(countries);

    const data = entries.map(([code, c]) => {
        return {
            name: c.name,
            native: c.native,
            phone: c.phone.map(p => Number(p)),
            continent: {
                code: c.continent,
                name: continents[c.continent],
            },
            capital: c.capital,
            currency: c.currency,
            languages: c.languages.map((code) => {
                const lang = languages[code];
                return {
                    code,
                    name: lang.name,
                    native: lang.native,
                    isRTL: Boolean(lang.rtl),
                };
            }),
            iso2: code,
            iso3: (c as any)?.iso3 ?? '',
            partOf: c.partOf ?? '',
            userAssigned: c.userAssigned ?? false,
            flag: `https://flagcdn.com/w320/${code.toLowerCase()}.png`,
            code: code as I_Country['code'],
            ...mongo.createGenericFields(),
        };
    });

    const existing = await countryCtr.findAll({ code: { $in: data.map(d => d.code) as any } });
    const existingCodes = (existing.success && existing.result)
        ? new Set(existing.result.map(c => c.code))
        : new Set();
    const insert = data.filter(d => !existingCodes.has(d.code));

    if (!insert.length) {
        log.info('No new countries to insert.');
        return;
    }

    const result = await countryCtr.createMany(insert);
    if (!result.success) {
        log.error('Failed to insert new countries');
        return;
    }

    log.success(`Inserted ${insert.length} countries.`);
}

export async function down(db: C_Db) {
    const countryCtr = new MongoController<I_Country>(db, 'country');
    const result = await countryCtr.deleteMany({ code: { $in: Object.keys(countries) as I_Country['code'][] } });

    if (!result.success) {
        log.error('Failed to delete countries');
        return;
    }

    log.success(`Deleted ${Object.keys(countries).length} countries.`);
}
