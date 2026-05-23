import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Location } from './location.type.js';

import { E_Destination_PinStyle, E_Event_PinStyle, E_LocationEntityType, E_User_PinStyle } from './location.type.js';

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
    },
});

export const LocationModel = mongo.createModel<I_Location>({
    mongoose,
    name: 'Location',
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
        pinStyle: {
            type: String,
            enum: [...Object.values(E_User_PinStyle), ...Object.values(E_Event_PinStyle), ...Object.values(E_Destination_PinStyle)],
        },
        entityType: {
            type: String,
            enum: Object.values(E_LocationEntityType),
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter entityType for like',
                },
            ],
        },
        entityId: {
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
        {
            name: 'entity',
            options: {
                ref: doc => doc.entityType,
                localField: 'entityId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});

// Index for cron job performance
LocationModel.schema.index({ entityType: 1, entityId: 1 }, { name: 'idx_locations_entity' });
