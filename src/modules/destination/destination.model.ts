import type { T_QueryWithHelpers } from '@cyberskill/shared/node/mongo';

import { mongo, MongooseController } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { FaqSchema } from '#modules/blog/blog.model.js';
import { RatingSchema } from '#modules/rating/index.js';
import { SeoSchema } from '#modules/seo/seo.schema.js';

import type { I_Destination, I_Hotel } from './destination.type.js';

import { E_DestinationAgeGroup, E_DestinationRating, E_DestinationType } from './destination.type.js';

export const HotelSchema = mongo.createSchema<I_Hotel>({
    standalone: true,
    mongoose,
    schema: {
        name: {
            type: Object,
        },
        locationId: {
            type: String,
        },
        url: {
            type: String,
        },
        description: {
            type: Object,
        },
        image: {
            type: String,
        },
    },
    virtuals: [
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
});

export const DestinationModel = mongo.createModel<I_Destination>({
    mongoose,
    name: 'Destination',
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
            type: Object,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the destination name',
                },
            ],
        },
        slug: {
            type: Object,
            require: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the slug.',
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
            type: Object,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the introduction headline',
                },
            ],
        },
        introductionContent: {
            type: Object,
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
        ratingStar: {
            type: String,
        },
        logo: {
            type: String,
        },
        locationId: {
            type: String,
        },
        nearbyHotels: {
            type: [HotelSchema],
        },
        wearImage: {
            type: String,
        },
        womenDressCode: {
            type: Object,
        },
        menDressCode: {
            type: Object,
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
            type: Object,
        },
        highlightWellness: {
            type: Object,
        },
        highlightBar: {
            type: Object,
        },
        highlightDance: {
            type: Object,
        },
        seo: {
            type: SeoSchema,
        },
        faqs: {
            type: [FaqSchema],
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
        translationSnapshot: {
            type: Object,
            default: {},
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

async function createMiddleware(this: I_Destination) {
    if (!this.isNew)
        return;
    try {
        const mongooseCtr = new MongooseController<I_Destination>(DestinationModel);

        const nameValue = typeof this.name === 'object' && this.name !== null ? ((this.name as Record<string, string>)['en'] || '') : (this.name || '');
        const newSlug = await mongooseCtr.createSlug({
            field: 'name',
            from: { name: nameValue } as any,
        });

        if (!newSlug.success) {
            throw new Error(newSlug.message);
        }

        this.slug = { en: newSlug.result };
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};

async function updateMiddleware(this: T_QueryWithHelpers<I_Destination>) {
    try {
        const mongooseCtr = new MongooseController<I_Destination>(DestinationModel);
        const newData = this.getUpdate() as I_Destination;
        const query = this.findOne(this.getFilter());
        const oldData = await query.clone().exec();

        if (!oldData) {
            throw new Error('Page not found');
        }

        const newNameEn = typeof newData.name === 'object' && newData.name !== null ? ((newData.name as Record<string, string>)['en'] || '') : (newData.name || '');
        const oldNameEn = typeof oldData.name === 'object' && oldData.name !== null ? ((oldData.name as Record<string, string>)['en'] || '') : (oldData.name || '');
        const shouldGenerateSlug = !!(newNameEn && oldNameEn && newNameEn !== oldNameEn);

        if (shouldGenerateSlug) {
            const newSlug = await mongooseCtr.createSlug({
                field: 'name',
                from: { name: newNameEn } as any,
            });

            if (!newSlug.success) {
                throw new Error(newSlug.message);
            }

            newData.slug = { en: newSlug.result };
        }
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};
