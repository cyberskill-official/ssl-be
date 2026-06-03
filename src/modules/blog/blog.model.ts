import type { T_QueryWithHelpers } from '@cyberskill/shared/node/mongo';

import { mongo, MongooseController } from '@cyberskill/shared/node/mongo';
import mongoose from 'mongoose';

import { SeoSchema } from '#modules/seo/seo.schema.js';
import { SocialLinkSchema } from '#modules/setting/index.js';

import type { I_Blog } from './blog.type.js';

import { E_BlogCategory, E_BlogType } from './blog.type.js';

export const FaqSchema = mongo.createSchema({
    standalone: true,
    mongoose,
    schema: {
        question: {
            type: Object,
        },
        answer: {
            type: Object,
        },
    },
});

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
            type: Object,
            require: true,
            validate: [
                {
                    validator: mongo.validator.isRequired(),
                    message: 'Please enter the slug.',
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
        faqs: {
            type: [FaqSchema],
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
        translationSnapshot: {
            type: Object,
            default: {},
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
    if (!this.isNew)
        return;
    try {
        const mongooseCtr = new MongooseController<I_Blog>(BlogModel);

        const titleEn = typeof this.title === 'string' ? this.title : (this.title as any)?.en;
        const newSlug = await mongooseCtr.createSlug({
            field: 'title',
            from: { title: titleEn } as any,
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
}

async function updateMiddleware(this: T_QueryWithHelpers<I_Blog>) {
    try {
        const mongooseCtr = new MongooseController<I_Blog>(BlogModel);
        const newData = this.getUpdate() as I_Blog;
        const query = this.findOne(this.getFilter());
        const oldData = await query.clone().exec();

        if (!oldData) {
            throw new Error('Page not found');
        }

        const oldTitleEn = typeof oldData.title === 'string' ? oldData.title : (oldData.title as any)?.en;
        const newTitleEn = typeof newData.title === 'string' ? newData.title : (newData.title as any)?.en;

        const shouldGenerateSlug = !!(
            newTitleEn
            && oldTitleEn
            && newTitleEn !== oldTitleEn
        );

        if (shouldGenerateSlug) {
            const newSlug = await mongooseCtr.createSlug({
                field: 'title',
                from: { title: newTitleEn } as any,
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
