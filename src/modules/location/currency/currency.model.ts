import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Currency } from './currency.type.js';

export const CurrencyModel = mongo.createModel<I_Currency>({
    mongoose,
    name: 'Currency',
    schema: {
        name: {
            type: String,
        },
        code: {
            type: String,
        },
        symbol: {
            type: String,
        },
    },
});
