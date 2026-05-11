import type { T_QueryWithHelpers } from '@cyberskill/shared/node/mongo';

import { mongo, MongooseController } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { SeoSchema } from '#modules/seo/index.js';
import { SocialLinkSchema } from '#modules/setting/index.js';

import type { I_Blog } from './blog.type.js';

import { E_BlogCategory, E_BlogType } from './blog.type.js';

export const BlogModel = mongo.createModel<I_Blog>({
    mongoose,
    name: 'Blog',
    schema: {
        title: {
            type: Object,
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please enter title for blog',
            },
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
        authorName: {
            type: String,
        },
        websiteName: {
            type: String,

        },
        websiteURL: {
            type: String,

        },
        type: {
            type: String,
            enum: [
                ...Object.values(E_BlogType),
            ],
            required: true,
            validate: {
                validator: mongo.validator.isRequired(),
                message: 'Please select type for blog',
            },
        },
        category: {
            type: String,
            enum: [
                ...Object.values(E_BlogCategory),
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
            type: Object,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content headline for blog',
                },
            ],
        },
        contentSubHeadline: {
            type: Object,
            required: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter content sub headline for blog',
                },
            ],
        },
        content: {
            type: Object,
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
        socialLinks: {
            type: [SocialLinkSchema],
        },
        authorId: {
            type: String,
        },
        seo: {
            type: SeoSchema,
        },
        isActive: {
            type: Boolean,
            default: false,
        },
        readCount: {
            type: Number,
            default: 0,
        },
        isLustEditorial: {
            type: Boolean,
            default: false,
        },
        iframe: {
            type: String,
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

async function createMiddleware(this: I_Blog) {
    try {
        const mongooseCtr = new MongooseController<I_Blog>(BlogModel);

        const newSlug = await mongooseCtr.createSlug({
            field: 'title',
            from: this,
        });

        if (!newSlug.success) {
            throw new Error(newSlug.message);
        }

        this.slug = newSlug.result;
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};

async function updateMiddleware(this: T_QueryWithHelpers<I_Blog>) {
    try {
        const mongooseCtr = new MongooseController<I_Blog>(BlogModel);
        const newData = this.getUpdate() as I_Blog;
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
    }
    catch (error) {
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
};
