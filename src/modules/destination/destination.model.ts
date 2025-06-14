import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import type { I_Destination, I_Hotel, I_Seo } from './destination.type.js';

import { E_AgeRange, E_DestinationType, E_Rating } from './destination.type.js';

export const NearbyHotelsSchema = mongo.createSchema<I_Hotel>({
    mongoose,
    schema: {
        name: {
            type: String,
        },
        address: {
            type: String,
        },
        countryId: {
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

export const SeoSchema = mongo.createSchema<I_Seo>({
    mongoose,
    schema: {
        title: {
            type: String,
        },
        description: {
            type: String,
        },
        keywords: [{
            type: String,
        }],
        socialImage: {
            type: String,
        },
        socialMediaDescription: {
            type: String,
        },
        urlSlug: {
            type: String,
        },
        altTextForImages: {
            type: String,
        },
    },
});
export const DestinationModel = mongo.createModel<I_Destination>({
    mongoose,
    name: 'Destination',
    pagination: true,
    schema: {
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
        countryId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please select the country',
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
        ageGroup: {
            type: String,
            enum: Object.values(E_AgeRange),
        },
        logo: {
            type: String,
        },
        location: {
            type: Object,
        },
        nearbyHotels: {
            type: [NearbyHotelsSchema],
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
        userDefaultText: {
            type: Boolean,
            default: false,
        },
        rating: {
            type: String,
            enum: Object.values(E_Rating),
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired (),
                    message: 'Please select ratting',
                },
            ],
        },
        images: [{
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter a valid image URL',
                },
            ],
        }],
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
        atmosphereRating: {
            rate: {
                type: Number,
                default: 0,
            },
            reason: {
                type: String,
            },
        },
        guestsRating: {
            rate: {
                type: Number,
                default: 0,
            },
            reason: {
                type: String,
            },
        },
        facilitiesRating: {
            rate: {
                type: Number,
                default: 0,
            },
            reason: {
                type: String,
            },
        },
        serviceRating: {
            rate: {
                type: Number,
                default: 0,
            },
            reason: {
                type: String,
            },
        },
        xFactorRating: {
            rate: {
                type: Number,
                default: 0,
            },
            reason: {
                type: String,
            },
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
            type: [SeoSchema],
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        createdById: {
            type: String,
        },
        linkTo: {
            type: String,
        },
    },
    virtuals: [
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
