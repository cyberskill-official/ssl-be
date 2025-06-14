import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { E_EvenType, type I_Event } from './event.type.js';

export const EventModel = mongo.createModel<I_Event>({
    mongoose,
    name: 'Event',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_EvenType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select event type',
                },
            ],
        },
        clubId: {
            type: String,
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
        startTime: {
            type: String,
        },
        endTime: {
            type: String,
        },
        countryId: {
            type: String,
        },
        cityId: {
            type: String,
        },
        location: {
            type: Object,
        },
        fee: {
            type: Number,
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
            name: 'club',
            options: {
                ref: 'Destination',
                localField: 'clubId',
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
