import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Location } from './location.type.js';

export const LocationSchema = mongo.createSchema<I_Location>({
    standalone: true,
    mongoose,
    schema: {
        regionId: {
            type: String,
        },
        subRegionId: {
            type: String,
        },
        countryId: {
            type: String,
        },
        stateId: {
            type: String,
        },
        cityId: {
            type: String,
        },
        raw: {
            type: Object,
        },
    },
    virtuals: [
        {
            name: 'region',
            options: {
                ref: 'Region',
                localField: 'regionId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'subRegion',
            options: {
                ref: 'SubRegion',
                localField: 'subRegionId',
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
            name: 'city',
            options: {
                ref: 'City',
                localField: 'cityId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
