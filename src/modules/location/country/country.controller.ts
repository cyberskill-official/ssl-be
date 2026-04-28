import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult, T_QueryFilter } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { applyNameFilters } from '#shared/util/filter-name.js';

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
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [
                { key: 'name', value: filter?.name, mode: 'startsWith' },
                { key: 'currency_name', value: filter?.currency_name, mode: 'contains' },
                { key: 'currency', value: filter?.currency, mode: 'contains' },
                { key: 'currency_symbol', value: filter?.currency_symbol, mode: 'contains' },
            ],
        );

        return mongooseCtr.findPaging(computedFilter as T_QueryFilter<I_Country>, options);
    },
};
