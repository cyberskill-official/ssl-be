import type { C_Db } from '@cyberskill/shared/node/mongo';

import { readJsonSync } from '@cyberskill/shared/node/fs';
import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_City, I_Country, I_Region, I_State, I_SubRegion } from '#modules/location/index.js';

const PATH = `./src/modules/mongo/migrations/location`;

interface I_RegionRaw extends I_Region {
    translations: Record<string, string>;
}

interface I_SubRegionRaw extends I_SubRegion {
    region_id: string;
    translations: Record<string, string>;
}

interface I_CountryRaw extends I_Country {
    region_id: string;
    subregion_id: string;
    subregion: string;
    translations: Record<string, string>;
}

interface I_StateRaw extends I_State {
    country_id: string;
    country_name: string;
}

interface I_CityRaw extends I_City {
    state_id: string;
    state_name: string;
    country_id: string;
    country_name: string;
}

const regions: I_RegionRaw[] = readJsonSync(`${PATH}/regions.json`);
const subregions: I_SubRegionRaw[] = readJsonSync(`${PATH}/subregions.json`);
const countries: I_CountryRaw[] = readJsonSync(`${PATH}/countries.json`);
const states: I_StateRaw[] = readJsonSync(`${PATH}/states.json`);
const cities: I_CityRaw[] = readJsonSync(`${PATH}/cities.json`);

export async function up(db: C_Db) {
    const regionCtr = new MongoController<I_Region>(db, 'regions');
    const subregionCtr = new MongoController<I_SubRegion>(db, 'subregions');
    const countryCtr = new MongoController<I_Country>(db, 'countries');
    const stateCtr = new MongoController<I_State>(db, 'states');
    const citytr = new MongoController<I_City>(db, 'cities');

    for (const { id, translations, ...rest } of regions) {
        const regionCreated = await regionCtr.createOne(rest);

        if (!regionCreated.success) {
            return log.error(`Failed to create region: ${rest.name}`);
        }

        const subregionsFound = subregions.filter((sub: I_SubRegionRaw) => sub.region_id === id);

        for (const { id, region_id, translations, ...subRest } of subregionsFound) {
            subRest.regionId = regionCreated.result.id;

            const subregionCreated = await subregionCtr.createOne(subRest);

            if (!subregionCreated.success) {
                return log.error(`Failed to create subregion: ${subRest.name}`);
            }

            const countriesFound = countries.filter((country: I_CountryRaw) => country.subregion_id === id);

            for (const { id, region_id, region, subregion_id, subregion, translations, ...countryRest } of countriesFound) {
                countryRest.subRegionId = subregionCreated.result.id;

                const countryCreated = await countryCtr.createOne(countryRest);

                if (!countryCreated.success) {
                    return log.error(`Failed to create country: ${countryRest.name}`);
                }

                const statesFound = states.filter((state: I_StateRaw) => state.country_id === id);

                for (const { id, country_id, country_name, ...stateRest } of statesFound) {
                    stateRest.countryId = countryCreated.result.id;

                    const stateCreated = await stateCtr.createOne(stateRest);

                    if (!stateCreated.success) {
                        return log.error(`Failed to create state: ${stateRest.name}`);
                    }

                    const citiesFound = cities.filter((city: I_CityRaw) => city.state_id === id);

                    for (const { id, country_id, country_name, state_id, state_name, ...cityRest } of citiesFound) {
                        cityRest.stateId = stateCreated.result.id;
                        cityRest.countryId = countryCreated.result.id;


                        const cityCreated = await citytr.createOne(cityRest);

                        if (!cityCreated.success) {
                            return log.error(`Failed to create city: ${cityRest.name}`);
                        }
                    }
                }
            }
        }
    }
}

export async function down(db: C_Db) {
    const regionCtr = new MongoController<I_Region>(db, 'regions');
    const subregionCtr = new MongoController<I_SubRegion>(db, 'subregions');
    const countryCtr = new MongoController<I_Country>(db, 'countries');
    const stateCtr = new MongoController<I_State>(db, 'states');
    const citytr = new MongoController<I_State>(db, 'cities');

    const regionDeleted = await regionCtr.deleteMany({});

    if (!regionDeleted.success) {
        return log.error('Failed to delete regions.');
    }

    log.success('Regions deleted successfully.');

    const subregionDeleted = await subregionCtr.deleteMany({});

    if (!subregionDeleted.success) {
        return log.error('Failed to delete subregions.');
    }

    log.success('Subregions deleted successfully.');

    const countryDeleted = await countryCtr.deleteMany({});

    if (!countryDeleted.success) {
        return log.error('Failed to delete countries.');
    }

    log.success('Countries deleted successfully.');

    const stateDeleted = await stateCtr.deleteMany({});

    if (!stateDeleted.success) {
        return log.error('Failed to delete states');
    }

    const cityDeleted = await citytr.deleteMany({});

    if (!cityDeleted.success) {
        return log.error('Failed to delete cities');
    }
}
