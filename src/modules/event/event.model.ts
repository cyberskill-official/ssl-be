import type { T_MongooseHookNextFunction, T_QueryWithHelpers } from '@cyberskill/shared/node/mongo';

import { mongo, MongooseController } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { LocationSchema } from '#modules/location/index.js';

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
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter title for event',
                },
            ],
        },
        slug: {
            type: String,
            require: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the slug.',
                },
                {
                    validator: mongo.validator.isUnique(['slug']),
                    message: 'Slug is duplicated.',
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
        image: {
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
        createdById: {
            type: String,
            required: true,
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

async function createMiddleware(this: I_Event, next: T_MongooseHookNextFunction) {
    try {
        const mongooseCtr = new MongooseController<I_Event>(EventModel);

        const newSlug = await mongooseCtr.createSlug({
            field: 'title',
            from: this,
        });

        if (!newSlug.success) {
            throw new Error(newSlug.message);
        }

        this.slug = newSlug.result;

        next();
    }
    catch (error) {
        next(error as Error);
    }
};

async function updateMiddleware(this: T_QueryWithHelpers<I_Event>, next: T_MongooseHookNextFunction) {
    try {
        const mongooseCtr = new MongooseController<I_Event>(EventModel);
        const newData = this.getUpdate() as I_Event;
        const query = this.findOne(this.getFilter());
        const oldData = await query.clone().exec();

        if (!oldData) {
            throw new Error('Page not found');
        }

        const shouldGenerateSlug = !!(
            newData.title
            && oldData.title
            && newData.title !== oldData.title
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

        next();
    }
    catch (error) {
        next(error as Error);
    }
};
