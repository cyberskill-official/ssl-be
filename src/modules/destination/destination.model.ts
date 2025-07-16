import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { LocationSchema } from '#modules/location/index.js';
import { RatingSchema } from '#modules/rating/index.js';
import { SeoSchema } from '#modules/seo/index.js';

import type { I_Destination, I_Hotel } from './destination.type.js';

import { E_DestinationAgeGroup, E_DestinationRating, E_DestinationType } from './destination.type.js';

export const HotelSchema = mongo.createSchema<I_Hotel>({
    standalone: true,
    mongoose,
    schema: {
        name: {
            type: String,
        },
        address: {
            type: String,
        },
        url: {
            type: String,
        },
        description: {
            type: String,
        },
        image: {
            type: String,
        },
    },
});

export const DestinationModel = mongo.createModel<I_Destination>({
    mongoose,
    name: 'Destination',
    pagination: true,
    schema: {
        type: {
            type: String,
            enum: Object.values(E_DestinationType),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the destination type',
                },
            ],
        },
        name: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the destination name',
                },
            ],
        },
        address: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the address',
                },
            ],
        },
        websiteURL: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter a valid URL',
                },
            ],
        },
        rating: {
            type: String,
            enum: Object.values(E_DestinationRating),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select ratting',
                },
            ],
        },
        images: {
            type: [String],
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please upload at least one image',
                },
            ],
        },
        introductionHeadline: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the introduction headline',
                },
            ],
        },
        introductionContent: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the introduction content',
                },
            ],
        },
        ageGroup: {
            type: String,
            enum: Object.values(E_DestinationAgeGroup),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the age group',
                },
            ],
        },
        logo: {
            type: String,
        },
        location: {
            type: LocationSchema,
        },
        nearbyHotels: {
            type: [HotelSchema],
        },
        wearImage: {
            type: String,
        },
        womenDressCode: {
            type: String,
        },
        menDressCode: {
            type: String,
        },
        useDefaultText: {
            type: Boolean,
            default: false,
        },
        atmosphereRating: {
            type: RatingSchema,
        },
        guestsRating: {
            type: RatingSchema,
        },
        facilitiesRating: {
            type: RatingSchema,
        },
        serviceRating: {
            type: RatingSchema,
        },
        xFactorRating: {
            type: RatingSchema,
        },
        highlightSex: {
            type: String,
        },
        highlightWellness: {
            type: String,
        },
        highlightBar: {
            type: String,
        },
        highlightDance: {
            type: String,
        },
        seo: {
            type: SeoSchema,
        },
        linkTo: {
            type: String,
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        createdById: {
            type: String,
        },
    },
    virtuals: [
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
});
