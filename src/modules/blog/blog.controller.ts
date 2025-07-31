import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { languageCtr } from '#modules/language/index.js';

import type { I_Blog, I_Input_CreateBlog, I_Input_QueryBlog, I_Input_UpdateBlog } from './blog.type.js';

import { BlogModel } from './blog.model.js';

const mongooseCtr = new MongooseController<I_Blog>(BlogModel);

export const blogCtr = {
    getBlog: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryBlog>,
    ): Promise<I_Return<I_Blog>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getBlogs: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryBlog>,
    ): Promise<I_Return<T_PaginateResult<I_Blog>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createBlog: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateBlog>,
    ): Promise<I_Return<I_Blog>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const { languageId, relatedBlogsIds } = doc;
        doc.authorId = currentUser.id;

        if (languageId) {
            const language = await languageCtr.getLanguage(context, {
                filter: { id: languageId },
                projection: { id: 1 },
            });

            if (!language) {
                throwError({
                    message: 'Language does not exist',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        if (relatedBlogsIds) {
            const blogs = await blogCtr.getBlogs(context, {
                filter: { id: { $in: relatedBlogsIds } },
                options: {
                    projection: { id: 1 },
                    limit: relatedBlogsIds?.length,
                },
            });
            if (!blogs.success) {
                throwError({
                    message: 'Error fetching related blogs',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            if (blogs.result.docs.length !== relatedBlogsIds?.length) {
                throwError({
                    message: 'One or more relatedBlogsIds do not exist',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        return mongooseCtr.createOne(doc);
    },
    updateBlog: async (
        context: I_Context,
        { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateBlog>,
    ): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter });

        if (!blogFound.success) {
            throwError({
                message: 'Blog not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const { languageId, relatedBlogsIds } = update;

        if (languageId) {
            const language = await languageCtr.getLanguage(context, {
                filter: { id: languageId },
                projection: { id: 1 },
            });

            if (!language) {
                throwError({
                    message: 'Language does not exist',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        if (relatedBlogsIds) {
            const blogs = await blogCtr.getBlogs(context, {
                filter: { id: { $in: relatedBlogsIds } },
                options: {
                    projection: { id: 1 },
                    limit: relatedBlogsIds?.length,
                },
            });
            if (!blogs.success) {
                throwError({
                    message: 'Error fetching related blogs',
                    status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                });
            }

            if (blogs.result.docs.length !== relatedBlogsIds?.length) {
                throwError({
                    message: 'One or more relatedBlogsIds do not exist',
                    status: RESPONSE_STATUS.BAD_REQUEST,
                });
            }
        }

        if (update.featuredImage || update.logo || update.cover || update.file) {
            const existingBlog = await blogCtr.getBlog(context, {
                filter,
                projection: { featuredImage: 1, logo: 1, cover: 1, file: 1 },
            });

            if (existingBlog.success) {
                const mediaFields: Array<keyof Pick<I_Input_UpdateBlog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

                for (const field of mediaFields) {
                    if (update[field] && existingBlog.result[field] && existingBlog.result[field] !== update[field]) {
                        const imageDeleted = await bunnyCtr.deleteFile(context, existingBlog.result[field]);

                        if (!imageDeleted.success) {
                            throwError({
                                status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                                message: imageDeleted.message,
                            });
                        }
                    }
                }
            }
        }

        return mongooseCtr.updateOne(filter, update, options);
    },
    deleteBlog: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryBlog>,
    ): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter, options });

        if (!blogFound.success) {
            throwError({
                message: 'Blog not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        const mediaFields: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

        for (const field of mediaFields) {
            if (blogFound.result[field]) {
                const imageDeleted = await bunnyCtr.deleteFile(context, blogFound.result[field]);

                if (!imageDeleted.success) {
                    throwError({
                        status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR,
                        message: imageDeleted.message,
                    });
                }
            }
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    updateReadCount: async (
        context: I_Context,
        { filter }: I_Input_FindOne<I_Input_QueryBlog>,
    ): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter });

        if (!blogFound.success) {
            throwError({
                message: 'Blog not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
        }

        return mongooseCtr.updateOne(
            filter,
            { $inc: { readCount: 1 } },
            { new: true },
        );
    },
};
