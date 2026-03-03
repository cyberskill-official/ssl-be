import type { T_QueryWithHelpers } from '@cyberskill/shared/node/mongo';

import { mongo, MongooseController } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Event } from './event.type.js';

import { E_EventType } from './event.type.js';

export const EventModel = mongo.createModel<I_Event>({
    mongoose,
    name: 'Event',
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
            type: Object,
        },
        slug: {
            type: String,
        },
        description: {
            type: Object,
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
        image: {
            type: String,
        },
        createdById: {
            type: String,
            required: true,
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
        locationId: {
            type: String,
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
        isActive: {
            type: Boolean,
            default: true,
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
        {
            name: 'createdBy',
            options: {
                ref: 'User',
                localField: 'createdById',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'location',
            options: {
                ref: 'Location',
                localField: 'locationId',
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

async function createMiddleware(this: I_Event) {
    try {
        const mongooseCtr = new MongooseController<I_Event>(EventModel);

        if (this.title) {
            const newSlug = await mongooseCtr.createSlug({
                field: 'title',
                from: this,
            });

            if (!newSlug.success) {
                throw new Error(newSlug.message);
            }

            this.slug = newSlug.result;
        }
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};

async function updateMiddleware(this: T_QueryWithHelpers<I_Event>) {
    try {
        const mongooseCtr = new MongooseController<I_Event>(EventModel);
        const newData = this.getUpdate() as I_Event;
        const query = this.findOne(this.getFilter());
        const oldData = await query.clone().exec();

        if (!oldData) {
            throw new Error('Page not found');
        }

        const shouldGenerateSlug = !!(
            newData.title && newData.title !== oldData.title
        );

        if (shouldGenerateSlug) {
            const newSlug = await mongooseCtr.createSlug({
                field: 'title',
                from: newData,
            });

            if (!newSlug.success) {
                throw new Error(newSlug.message);
            }

            newData.slug = newSlug.result;
        }
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};
