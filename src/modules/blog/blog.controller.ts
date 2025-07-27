import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/authn.controller.js';
import { languageCtr } from '#modules/language/language.controller.js';

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

        return await mongooseCtr.updateOne(filter, update, options);
    },
    deleteBlog: async (
        context: I_Context,
        { filter, options }: I_Input_DeleteOne<I_Input_QueryBlog>,
    ): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter });

        if (!blogFound.success) {
            throwError({
                message: 'Blog not found.',
                status: RESPONSE_STATUS.NOT_FOUND,
            });
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
