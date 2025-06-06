import type { TContinentCode, TCountryCode, TLanguageCode } from 'countries-list';

import { mongo } from '@cyberskill/shared/node/mongo';
import { continents, countries, languages } from 'countries-list';
import mongoose from 'mongoose';

import type { I_Country } from './country.type.js';

const continentCodes = Object.keys(continents) as TContinentCode[];
const countryCodes = Object.keys(countries) as TCountryCode[];
const languageCodes = Object.keys(languages) as TLanguageCode[];

export const CountryModel = mongo.createModel<I_Country>({
    mongoose,
    name: 'Country',
    pagination: true,
    schema: {
        name: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country name',
                },
                {
                    validator: mongo.validator.isUnique(['name']),
                    message: 'Country name is unique',
                },
            ],
        },
        native: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country native',
                },
                {
                    validator: mongo.validator.isUnique(['name']),
                    message: 'Country native is unique',
                },
            ],
        },
        phone: [{
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter phone',
                },
            ],
        }],
        continent: {
            code: {
                type: String,
                required: true,
                unique: true,
                enum: continentCodes,
                validate: [
                    {
                        validator: mongo.validator.isEmpty(),
                        message: 'Please enter continent code',
                    },
                    {
                        validator: mongo.validator.isUnique(['code']),
                        message: 'Continent code is unique',
                    },
                ],
            },
            name: {
                type: String,
                required: true,
                unique: true,
                validate: [
                    {
                        validator: mongo.validator.isEmpty(),
                        message: 'Please enter continent name',
                    },
                    {
                        validator: mongo.validator.isUnique(['name']),
                        message: 'Continent name is unique',
                    },
                ],
            },
        },
        capital: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country capital',
                },
                {
                    validator: mongo.validator.isUnique(['capital']),
                    message: 'Country capital is unique',
                },
            ],
        },
        currency: [{
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country currency',
                },
            ],
        }],
        languages: [
            {
                code: {
                    type: String,
                    required: true,
                    unique: true,
                    enum: languageCodes,
                    validate: [
                        {
                            validator: mongo.validator.isEmpty(),
                            message: 'Please enter language code',
                        },
                        {
                            validator: mongo.validator.isUnique(['code']),
                            message: 'Language code is unique',
                        },
                    ],
                },
                name: {
                    type: String,
                    required: true,
                    unique: true,
                    validate: [
                        {
                            validator: mongo.validator.isEmpty(),
                            message: 'Please enter language name',
                        },
                        {
                            validator: mongo.validator.isUnique(['name']),
                            message: 'Language name is unique',
                        },
                    ],
                },
                native: {
                    type: String,
                    required: true,
                    unique: true,
                    validate: [
                        {
                            validator: mongo.validator.isEmpty(),
                            message: 'Please enter language native',
                        },
                        {
                            validator: mongo.validator.isUnique(['native']),
                            message: 'Language native is unique',
                        },
                    ],
                },
                isRTL: {
                    type: Boolean,
                    default: false,
                    validate: [
                        {
                            validator: mongo.validator.isEmpty(),
                            message: 'isRTL is required',
                        },
                    ],
                },
            },
        ],
        iso2: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country iso2',
                },
                {
                    validator: mongo.validator.isUnique(['iso2']),
                    message: 'Country iso2 is unique',
                },
            ],
        },
        iso3: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country iso3',
                },
                {
                    validator: mongo.validator.isUnique(['iso2']),
                    message: 'Country iso3 is unique',
                },
            ],
        },
        partOf: {
            type: String,
        },
        userAssigned: {
            type: Boolean,
        },
        flag: {
            type: String,
            required: true,
            unique: true,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country flag',
                },
                {
                    validator: mongo.validator.isUnique(['flag']),
                    message: 'Country flag is unique',
                },
            ],
        },
        code: {
            type: String,
            required: true,
            unique: true,
            enum: countryCodes,
            validate: [
                {
                    validator: mongo.validator.isEmpty(),
                    message: 'Please enter country code',
                },
                {
                    validator: mongo.validator.isUnique(['code']),
                    message: 'Country code is unique',
                },
            ],
        },
    },
});
