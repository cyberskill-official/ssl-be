import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult, T_QueryFilter } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { queryCacheService } from '#shared/redis/query-cache.service.js';
import { applyNameFilters, buildStartsWithFilter, escapeRegex } from '#shared/util/filter-name.js';

import type { I_Country, I_Input_QueryCountry } from './country.type.js';

import { CountryModel } from './country.model.js';

const mongooseCtr = new MongooseController<I_Country>(CountryModel);

export const countryCtr = {
    getCountry: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryCountry>,
    ): Promise<I_Return<I_Country>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getCountries: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryCountry>,
    ): Promise<I_Return<T_PaginateResult<I_Country>>> => {
        const nameSearch = typeof filter?.name === 'string' ? filter.name.trim() : '';

        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [
                // Skip 'name' here — we handle it below with $or to also match iso2/iso3
                { key: 'currency_name', value: filter?.currency_name, mode: 'contains' },
                { key: 'currency', value: filter?.currency, mode: 'contains' },
                { key: 'currency_symbol', value: filter?.currency_symbol, mode: 'contains' },
            ],
        );

        // If the user typed a country search term, match against name, iso2, and iso3
        // so "USA" (iso3), "US" (iso2), and "United States" (name) all work
        if (nameSearch) {
            const nameRegex = buildStartsWithFilter(nameSearch);
            const isoRegex = { $regex: `^${escapeRegex(nameSearch)}$`, $options: 'i' };

            computedFilter['$or'] = [
                ...(nameRegex ? [{ name: nameRegex }] : []),
                { iso2: isoRegex },
                { iso3: isoRegex },
            ];

            // Remove the raw 'name' key so it doesn't conflict with $or
            delete computedFilter['name'];
        }

        // Caching strategy for getCountries
        const cacheKey = { filter: computedFilter, options };
        return queryCacheService.getOrSet<I_Return<T_PaginateResult<I_Country>>>({
            scope: 'country:getCountries',
            key: cacheKey,
            ttl: 1800, // 30 minutes
            loader: async () => mongooseCtr.findPaging(computedFilter as T_QueryFilter<I_Country>, options),
        });
    },
};
