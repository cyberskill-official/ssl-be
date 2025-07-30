import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_Entity } from '#shared/typescript/index.js';

import type { I_Location } from './location.type.js';

export const MapSchema = mongo.createSchema({
    standalone: true,
    mongoose,
    schema: {
        latitude: {
            type: Number,
        },
        longitude: {
            type: Number,
        },
        zoomLevel: {
            type: Number,
        },
        entity: {
            type: String,
            enum: Object.values(E_Entity),
        },
    },
});

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
        address: {
            type: String,
        },
        map: {
            type: MapSchema,
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
