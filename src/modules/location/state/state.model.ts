import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_State } from './state.type.js';

export const StateModel = mongo.createModel<I_State>({
    mongoose,
    name: 'State',
    schema: {
        name: {
            type: String,
        },
        countryId: {
            type: String,
        },
        code: {
            type: String,
        },
        type: {
            type: String,
        },
        latitude: {
            type: String,
        },
        longitude: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'country',
            options: {
                ref: 'Country',
                localField: 'countryId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
