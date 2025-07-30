import type { C_Db } from '@cyberskill/shared/node/mongo';

import { readJsonSync } from '@cyberskill/shared/node/fs';
import { log } from '@cyberskill/shared/node/log';
import { MongoController } from '@cyberskill/shared/node/mongo';

import type { I_City, I_Country, I_Region, I_State, I_SubRegion } from '#modules/location/index.js';

const PATH = `./src/shared/mongo/migrations/data`;
// Source: https://github.com/dr5hn/countries-states-cities-database/tree/master/json

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
    const cityCtr = new MongoController<I_City>(db, 'cities');

    try {
        const regionCreated = await regionCtr.createMany(regions.map(region => ({
            ...region,
            id: `${region.id}`,
        })));

        if (!regionCreated.success) {
            return log.error(`Failed to create regions`);
        }

        const regionMap = new Map(regions.map(region => [`${region.id}`, regionCreated.result.find(r => `${r.id}` === `${region.id}`)]));

        const subregionMap = new Map<string, I_SubRegionRaw[]>();

        subregions.forEach((subregion) => {
            if (!subregionMap.has(`${subregion.region_id}`)) {
                subregionMap.set(`${subregion.region_id}`, []);
            }
            subregionMap.get(`${subregion.region_id}`)!.push(subregion);
        });

        for (const [regionId, subregionList] of subregionMap.entries()) {
            const region = regionMap.get(regionId);

            if (region) {
                const subregionCreated = await subregionCtr.createMany(subregionList.map(sub => ({
                    ...sub,
                    id: `${sub.id}`,
                    regionId: `${region.id}`,
                })));

                if (!subregionCreated.success) {
                    log.error(`Failed to create subregions for region: ${region.name}`);
                    continue;
                }
            }
        }

        const countryMap = new Map<string, I_CountryRaw[]>();

        countries.forEach((country) => {
            if (!countryMap.has(`${country.subregion_id}`)) {
                countryMap.set(`${country.subregion_id}`, []);
            }
            countryMap.get(`${country.subregion_id}`)!.push(country);
        });

        for (const [subregionId, countryList] of countryMap.entries()) {
            const subregion = subregions.find(s => `${s.id}` === `${subregionId}`);

            if (subregion) {
                const countryCreated = await countryCtr.createMany(countryList.map(country => ({
                    ...country,
                    id: `${country.id}`,
                    regionId: `${subregion.region_id}`,
                    subRegionId: `${subregion.id}`,
                })));

                if (!countryCreated.success) {
                    log.error(`Failed to create countries for subregion: ${subregion.name}`);
                    continue;
                }
            }
        }

        const stateMap = new Map<string, I_StateRaw[]>();

        states.forEach((state) => {
            if (!stateMap.has(`${state.country_id}`)) {
                stateMap.set(`${state.country_id}`, []);
            }
            stateMap.get(`${state.country_id}`)!.push(state);
        });

        for (const [countryId, stateList] of stateMap.entries()) {
            const country = countries.find(c => `${c.id}` === `${countryId}`);

            if (country) {
                const stateCreated = await stateCtr.createMany(stateList.map(state => ({
                    ...state,
                    id: `${state.id}`,
                    countryId: `${country.id}`,
                })));

                if (!stateCreated.success) {
                    log.error(`Failed to create states for country: ${country.name}`);
                    continue;
                }
            }
        }

        const cityMap = new Map<string, I_CityRaw[]>();

        cities.forEach((city) => {
            if (!cityMap.has(`${city.state_id}`)) {
                cityMap.set(`${city.state_id}`, []);
            }
            cityMap.get(`${city.state_id}`)!.push(city);
        });

        for (const [stateId, cityList] of cityMap.entries()) {
            const state = states.find(s => `${s.id}` === `${stateId}`);

            if (state) {
                const cityCreated = await cityCtr.createMany(cityList.map(city => ({
                    ...city,
                    id: `${city.id}`,
                    stateId: `${state.id}`,
                    countryId: `${city.country_id}`,
                })));

                if (!cityCreated.success) {
                    log.error(`Failed to create cities for state: ${state.name}`);
                    continue;
                }
            }
        }

        log.success('Migration completed successfully');
    }
    catch (error) {
        log.error('Error during migration process', error);
    }
}

export async function down(db: C_Db) {
    const regionCtr = new MongoController<I_Region>(db, 'regions');
    const subregionCtr = new MongoController<I_SubRegion>(db, 'subregions');
    const countryCtr = new MongoController<I_Country>(db, 'countries');
    const stateCtr = new MongoController<I_State>(db, 'states');
    const cityCtr = new MongoController<I_City>(db, 'cities');

    try {
        await Promise.all([
            regionCtr.deleteMany({ name: { $in: regions.map(r => r.name) } }),
            subregionCtr.deleteMany({ name: { $in: subregions.map(s => s.name) } }),
            countryCtr.deleteMany({ name: { $in: countries.map(c => c.name) } }),
            stateCtr.deleteMany({ name: { $in: states.map(s => s.name) } }),
            cityCtr.deleteMany({ name: { $in: cities.map(c => c.name) } }),
        ]);

        log.success('All entities deleted successfully');
    }
    catch (error) {
        log.error('Error during down migration', error);
    }
}
