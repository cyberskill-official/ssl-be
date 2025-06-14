import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { SeoSchema } from '#modules/destination/destination.model.js';

import { E_CategoryBlog, E_CategoryPodcast, E_SocialPlatform, type I_Blog } from './blog.type.js';

export const BlogModel = mongo.createModel<I_Blog>({
    mongoose,
    name: 'Blog',
    pagination: true,
    schema: {
        title: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter title for blog',
            },
        },
        languageId: {
            type: String,
        },
        authorName: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter author name for blog',
            },
        },
        hostName: {
            type: String,
        },
        websiteName: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter website name for blog',
            },
        },
        websiteURL: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter website URL for blog',
            },
        },
        publishDate: {
            type: Date,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please select publish date for blog',
            },
        },
        category: {
            type: String,
            enum: [
                ...Object.values(E_CategoryBlog),
                ...Object.values(E_CategoryPodcast),
            ],
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please select category for blog',
            },
        },
        logo: {
            type: String,
        },
        cover: {
            type: String,
        },
        file: {
            type: String,
        },
        featuredImage: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter featured image for blog',
                },
            ],
        },
        contentHeadline: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content headline for blog',
                },
            ],
        },
        contentSubHeadline: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content sub headline for blog',
                },
            ],
        },
        content: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content for blog',
                },
            ],
        },
        relatedArticles: {
            type: [String],
        },
        socialPlatform: {
            type: String,
            enum: Object.values(E_SocialPlatform),
        },
        socialURL: {
            type: String,
        },
        authorProfileId: {
            type: String,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter author user for this post blog.',
                },
            ],
        },
        seo: {
            type: [SeoSchema],
        },
    },
    virtuals: [
        {
            name: 'author',
            options: {
                ref: 'User',
                localField: 'authorProfileId',
                foreignField: 'id',
                justOne: true,
            },
        },
        {
            name: 'language',
            options: {
                ref: 'Language',
                localField: 'languageId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
