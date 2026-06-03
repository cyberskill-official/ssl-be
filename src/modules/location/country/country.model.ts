import type { T_QueryWithHelpers } from '@cyberskill/shared/node/mongo';

import { mongo, MongooseController } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { queryCacheService } from '#shared/redis/query-cache.service.js';

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
        slug: {
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
            type: String,
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
    middlewares: [
        {
            method: 'save',
            pre: createMiddleware,
        },
        {
            method: 'findOneAndUpdate',
            pre: updateMiddleware,
        },
    ],
});

async function createMiddleware(this: I_Country) {
    try {
        const mongooseCtr = new MongooseController<I_Country>(CountryModel);

        const newSlug = await mongooseCtr.createSlug({
            field: 'name',
            from: this,
        });

        if (!newSlug.success) {
            throw new Error(newSlug.message);
        }

        this.slug = newSlug.result;

        // Bump cache version for country scope
        await queryCacheService.bumpVersion('country');
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};

async function updateMiddleware(this: T_QueryWithHelpers<I_Country>) {
    try {
        const mongooseCtr = new MongooseController<I_Country>(CountryModel);
        const newData = this.getUpdate() as I_Country;
        const query = this.findOne(this.getFilter());
        const oldData = await query.clone().exec();

        if (!oldData) {
            throw new Error('Page not found');
        }

        const shouldGenerateSlug = !!(
            newData.name
            && oldData.name
            && newData.name !== oldData.name
        );

        if (shouldGenerateSlug) {
            const newSlug = await mongooseCtr.createSlug({
                field: 'name',
                from: newData,
            });

            if (!newSlug.success) {
                throw new Error(newSlug.message);
            }

            newData.slug = newSlug.result;
        }

        // Bump cache version for country scope
        await queryCacheService.bumpVersion('country');
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};
