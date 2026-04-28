import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_CreateCurrency, I_Input_QueryCurrency, I_Input_UpdateCurrency } from './currency.type.js';

import { currencyCtr } from './currency.controller.js';

const CurrencyResolver = {
    Query: {
        getCurrency: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryCurrency>, context: I_Context) => currencyCtr.getCurrency(context, args),
        getCurrencies: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryCurrency>, context: I_Context) => currencyCtr.getCurrencies(context, args),
    },
    Mutation: {
        createCurrency: (_parent: unknown, args: I_Input_CreateOne<I_Input_CreateCurrency>, _context: I_Context) => currencyCtr.createCurrency(_context, args),
        updateCurrency: (_parent: unknown, args: I_Input_UpdateOne<I_Input_UpdateCurrency>, context: I_Context) => currencyCtr.updateCurrency(context, args),
        deleteCurrency: (_parent: unknown, args: I_Input_DeleteOne<I_Input_UpdateCurrency>, context: I_Context) => currencyCtr.deleteCurrency(context, args),
    },
};

export default CurrencyResolver;
