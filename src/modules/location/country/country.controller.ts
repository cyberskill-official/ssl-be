import type { I_Input_FindOne, I_Input_FindPaging, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

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
        const computedFilter = { ...(filter || {}) } as Record<string, unknown>;

        if (typeof filter?.name === 'string' && filter.name.trim() !== '') {
            const escaped = filter.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            computedFilter['name'] = { $regex: `^${escaped}`, $options: 'i' };
        }

        // Support searching by currency fields as well (case-insensitive, partial)
        if (
            typeof filter?.currency_name === 'string'
            && filter.currency_name.trim() !== ''
        ) {
            const escaped = filter.currency_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            computedFilter['currency_name'] = { $regex: escaped, $options: 'i' };
        }

        if (typeof filter?.currency === 'string' && filter.currency.trim() !== '') {
            const escaped = filter.currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            computedFilter['currency'] = { $regex: escaped, $options: 'i' };
        }

        if (
            typeof filter?.currency_symbol === 'string'
            && filter.currency_symbol.trim() !== ''
        ) {
            const escaped = filter.currency_symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            computedFilter['currency_symbol'] = { $regex: escaped, $options: 'i' };
        }

        return mongooseCtr.findPaging(computedFilter as unknown as never, options);
    },
};
