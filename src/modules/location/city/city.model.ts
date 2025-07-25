import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_City } from './city.type.js';

export const CityModel = mongo.createModel<I_City>({
    mongoose,
    name: 'City',
    schema: {
        name: {
            type: String,
        },
        stateId: {
            type: String,
        },
        countryId: {
            type: String,
        },
        latitude: {
            type: String,
        },
        longitude: {
            type: String,
        },
        wikiDataId: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'state',
            options: {
                ref: 'State',
                localField: 'stateId',
                foreignField: 'id',
                justOne: true,
            },
        },
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
