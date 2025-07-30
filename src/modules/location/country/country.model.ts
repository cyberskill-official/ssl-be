import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Country, I_TimeZone } from './country.type.js';

export const TimeZoneSchema = mongo.createSchema<I_TimeZone>({
    mongoose,
    schema: {
        zoneName: {
            type: String,
        },
        gmtOffset: {
            type: Number,
        },
        gmtOffsetName: {
            type: String,
        },
        abbreviation: {
            type: String,
        },
        tzName: {
            type: String,
        },
    },
});

export const CountryModel = mongo.createModel<I_Country>({
    mongoose,
    name: 'Country',
    schema: {
        name: {
            type: String,
        },
        iso2: {
            type: String,
        },
        iso3: {
            type: String,
        },
        numeric_code: {
            type: String,
        },
        phonecode: {
            type: [String],
        },
        capital: {
            type: String,
        },
        currency: {
            type: String,
        },
        currency_name: {
            type: String,
        },
        currency_symbol: {
            type: String,
        },
        tld: {
            type: String,
        },
        native: {
            type: String,
        },
        regionId: {
            type: String,
        },
        subRegionId: {
            type: String,
        },
        nationality: {
            type: String,
        },
        timezones: {
            type: [TimeZoneSchema],
        },
        latitude: {
            type: String,
        },
        longitude: {
            type: String,
        },
        emoji: {
            type: String,
        },
        emojiU: {
            type: String,
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
    ],
});
