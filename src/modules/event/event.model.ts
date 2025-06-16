import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { LocationSchema } from '#modules/location/location/index.js';

import { E_EventType, type I_Event } from './event.type.js';

export const EventModel = mongo.createModel<I_Event>({
    mongoose,
    name: 'Event',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_EventType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select event type',
                },
            ],
        },
        title: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter title for event',
                },
            ],
        },
        description: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter description for event',
                },
            ],
        },
        startDate: {
            type: Date,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select start date for event',
                },
            ],
        },
        endDate: {
            type: Date,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select end date for event',
                },
            ],
        },
        destinationId: {
            type: String,
        },
        startTime: {
            type: String,
        },
        endTime: {
            type: String,
        },
        location: {
            type: LocationSchema,
        },
        fee: {
            type: Number,
            default: 0,
        },
        currency: {
            type: String,
        },
        pushMessage: {
            type: String,
        },
    },
    virtuals: [
        {
            name: 'destination',
            options: {
                ref: 'Destination',
                localField: 'destinationId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
