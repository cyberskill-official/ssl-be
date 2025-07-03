import { mongo } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { SeoSchema } from '#modules/seo/index.js';
import { E_SocialPlatform } from '#modules/social-platform/index.js';

import type { I_Blog } from './blog.type.js';

import { E_BlogCategory_Blog, E_BlogCategory_Podcast } from './blog.type.js';

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
        authorName: {
            type: String,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter author name for blog',
            },
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
        category: {
            type: String,
            enum: [
                ...Object.values(E_BlogCategory_Blog),
                ...Object.values(E_BlogCategory_Podcast),
            ],
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please select category for blog',
            },
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
        relatedBlogsIds: {
            type: [String],
        },
        languageId: {
            type: String,
        },
        hostName: {
            type: String,
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
        socialPlatform: {
            type: String,
            enum: Object.values(E_SocialPlatform),
        },
        socialURL: {
            type: String,
        },
        authorId: {
            type: String,
        },
        seo: {
            type: [SeoSchema],
        },
        isActive: {
            type: Boolean,
            default: false,
        },
    },
    virtuals: [
        {
            name: 'relatedBlogs',
            options: {
                ref: 'Blog',
                localField: 'relatedBlogsIds',
                foreignField: 'id',
                justOne: false,
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
        {
            name: 'author',
            options: {
                ref: 'User',
                localField: 'authorId',
                foreignField: 'id',
                justOne: true,
            },
        },
    ],
});
