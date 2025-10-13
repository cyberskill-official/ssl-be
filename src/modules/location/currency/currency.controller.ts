import type { I_Input_CreateOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { applyNameFilters } from '#shared/util/filter-name.js';

import type { I_Currency, I_Input_CreateCurrency, I_Input_QueryCurrency, I_Input_UpdateCurrency } from './currency.type.js';

import { CurrencyModel } from './currency.model.js';

const mongooseCtr = new MongooseController<I_Currency>(CurrencyModel);

export const currencyCtr = {
    getCurrency: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryCurrency>,
    ): Promise<I_Return<I_Currency>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getCurrencies: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryCurrency>,
    ): Promise<I_Return<T_PaginateResult<I_Currency>>> => {
        const computedFilter = applyNameFilters(
            { ...(filter || {}) },
            [
                { key: 'name', value: filter?.name, mode: 'startsWith' },
            ],
        );

        return mongooseCtr.findPaging(computedFilter as unknown as never, options);
    },
    createCurrency: async (
        _context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateCurrency>,
    ): Promise<I_Return<I_Currency>> => {
        return mongooseCtr.createOne(doc);
    },
    updateCurrency: async (
        context: I_Context,
        { filter, update, options }:
        I_Input_UpdateOne<I_Input_UpdateCurrency>,
    ): Promise<I_Return<I_Currency>> => {
        const currencyFound = await currencyCtr.getCurrency(context, { filter });

        if (!currencyFound.success) {
            throwError({
                message: 'Currency not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteCurrency: async (
        context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryCurrency>,
    ): Promise<I_Return<I_Currency>> => {
        const currencyFound = await currencyCtr.getCurrency(context, { filter });

        if (!currencyFound.success) {
            throwError({
                message: 'Currency not found',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.deleteOne(filter);
    },
};
