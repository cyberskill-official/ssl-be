import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { languageCtr } from '#modules/language/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';

import type { I_Blog, I_Input_CreateBlog, I_Input_QueryBlog, I_Input_UpdateBlog } from './blog.type.js';

import { BlogModel } from './blog.model.js';

const mongooseCtr = new MongooseController<I_Blog>(BlogModel);
export const blogCtr = {
    getBlog: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryBlog>,
    ): Promise<I_Return<I_Blog>> => {
        const blogFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!blogFound.success) {
            return blogFound;
        }

        const imageFields: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

        for (const field of imageFields) {
            if (blogFound.result[field]) {
                blogFound.result[field] = bunnyCtr.generateSignedUrl({
                    fullUrl: blogFound.result[field]!,
                    extraQueryParams: {
                        class: 'normal',
                    },
                });
            }
        }

        return blogFound;
    },
    getBlogs: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryBlog>,
    ): Promise<I_Return<T_PaginateResult<I_Blog>>> => {
        const blogs = await mongooseCtr.findPaging(filter, options);

        if (!blogs.success) {
            return blogs;
        }

        blogs.result.docs = blogs.result.docs.map((blog) => {
            const imageFields: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

            for (const field of imageFields) {
                if (blog[field]) {
                    blog[field] = bunnyCtr.generateSignedUrl({
                        fullUrl: blog[field]!,
                        extraQueryParams: {
                            class: 'normal',
                        },
                    });
                }
            }

            return blog;
        });

        return blogs;
    },
    createBlog: async (
        context: I_Context,
        { doc }: I_Input_CreateOne<I_Input_CreateBlog>,
    ): Promise<I_Return<I_Blog>> => {
        const currentUser = await authnCtr.getUserFromSession(context);
        const authorId = currentUser.id;

        // gán tác giả
        doc.authorId = authorId;

        // validate language (nếu có)
        if (doc.languageId) {
            const language = await languageCtr.getLanguage(context, { filter: { id: doc.languageId } });
            if (!language.success) {
                throwError({ message: 'Language does not exist', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        // validate relatedBlogsIds (nếu có)
        if (doc.relatedBlogsIds?.length) {
            const blogsFound = await blogCtr.getBlogs(context, {
                filter: { id: { $in: doc.relatedBlogsIds } },
                options: { limit: doc.relatedBlogsIds.length },
            });
            if (!blogsFound.success) {
                throwError({ message: 'Error fetching related blogs', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }
            if (blogsFound.result.docs.length !== doc.relatedBlogsIds.length) {
                throwError({ message: 'One or more relatedBlogsIds do not exist', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        // tạo blog
        const blogResult = await mongooseCtr.createOne(doc);
        if (!blogResult.success)
            return blogResult;

        // ký thumbnail (nếu có) — không iframe
        let thumbnailUrl: string | undefined;
        try {
            if (blogResult.result.featuredImage) {
                thumbnailUrl = bunnyCtr.generateSignedUrl({
                    fullUrl: blogResult.result.featuredImage,
                    extraQueryParams: { class: 'normal' },
                });
            }
        }
        catch {
            // ignore
        }

        try {
            const users = await userCtr.getUsers(context, {
                filter: { isActive: true },
                options: { pagination: false },
            });

            if (users.success && users.result.docs.length > 0) {
                await Promise.all(
                    users.result.docs
                        .map(u => u.id)
                        .filter((id): id is string => !!id && id !== authorId)
                        .map(targetId =>
                            notificationCtr.createNotificationWithSettings(context, {
                                doc: {
                                    targetId,
                                    type: E_NotificationType.NEW_BLOG_POST,
                                    entityType: E_NotificationEntityType.BLOG,
                                    entityId: blogResult.result.id,
                                    actorId: authorId,
                                    title: `There is a new blog: "${blogResult.result.title}"`,
                                    presentation: {
                                        redirect: { kind: E_RedirectType.BLOG, id: blogResult.result.id },
                                        thumbnailUrl,
                                    },
                                },
                            }),
                        ),
                );
            }
        }
        catch {
            // không chặn flow tạo blog nếu notify lỗi
        }

        return blogResult;
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
            });

            if (existingBlog.success) {
                const mediaFields: Array<keyof Pick<I_Input_UpdateBlog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

                for (const field of mediaFields) {
                    if (update[field] && existingBlog.result[field] && existingBlog.result[field] !== update[field]) {
                        await bunnyCtr.deleteFile(context, existingBlog.result[field]);
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
                await bunnyCtr.deleteFile(context, blogFound.result[field]);
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
