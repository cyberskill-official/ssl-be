import type { I_Input_CreateOne, I_Input_DeleteOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { log, throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';
import { roleCtr } from '#modules/authz/role/role.controller.js';
import { E_Role, E_Role_Staff } from '#modules/authz/role/role.type.js';
import { bunnyCtr } from '#modules/bunny/index.js';
import { languageCtr } from '#modules/language/index.js';
import { notificationCtr } from '#modules/notification/index.js';
import { E_NotificationEntityType, E_NotificationType, E_RedirectType } from '#modules/notification/notification.type.js';
import { userCtr } from '#modules/user/index.js';
import { getEnv } from '#shared/env/index.js';
import { E_SessionPortal } from '#shared/session/index.js';
import { getBlockedUserIds, localizeDocument } from '#shared/util/index.js';

import type { I_Blog, I_Input_CreateBlog, I_Input_QueryBlog, I_Input_UpdateBlog } from './blog.type.js';

import { translationQueue } from '../translation/translation.queue.js';
import { normalizePodcastEmbedUrl } from './blog.embed.js';
import { BlogModel } from './blog.model.js';

const env = getEnv();
const LEADING_SLASHES_REGEX = /^\/+/u;
const mongooseCtr = new MongooseController<I_Blog>(BlogModel);
export const blogCtr = {
    getBlog: async (_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryBlog>): Promise<I_Return<I_Blog>> => {
        const blogFound = await mongooseCtr.findOne(filter, projection, options, populate);

        if (!blogFound.success) {
            return blogFound;
        }

        const imageFields: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];
        for (const field of imageFields) {
            if (blogFound.result[field]) {
                blogFound.result[field] = bunnyCtr.generateSignedUrl({ fullUrl: blogFound.result[field]!, extraQueryParams: { class: 'normal' } });
            }
        }

        const rawLocale = _context.req?.headers?.['x-accept-language'];
        const locale = typeof rawLocale === 'string' ? rawLocale.split(',')[0]?.trim() : undefined;
        if (locale && _context.req?.sessionPortal !== E_SessionPortal.ADMIN) {
            blogFound.result = localizeDocument(blogFound.result, locale);
        }

        return blogFound;
    },
    getBlogs: async (context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryBlog>): Promise<I_Return<T_PaginateResult<I_Blog>>> => {
        const effectiveFilter: Record<string, unknown> = { ...(filter ?? {}) };
        const efAny = effectiveFilter as Record<string, any>;
        if (efAny['isDel'] === undefined) {
            efAny['isDel'] = { $ne: true };
        }

        const blogs = await mongooseCtr.findPaging(effectiveFilter, options);

        if (!blogs.success)
            return blogs;

        // Get blocked user IDs for bidirectional blocking
        const blockedUserIds = await getBlockedUserIds(context);

        // Filter out blogs from blocked users
        let filteredDocs = blogs.result.docs;
        if (blockedUserIds.size > 0) {
            filteredDocs = blogs.result.docs.filter((blog) => {
                const authorId = blog.authorId || (blog.author as any)?.id;
                return !authorId || !blockedUserIds.has(authorId);
            });
        }

        filteredDocs = filteredDocs.map((blog) => {
            const imageFields: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

            for (const field of imageFields) {
                if (blog[field]) {
                    blog[field] = bunnyCtr.generateSignedUrl({ fullUrl: blog[field]!, extraQueryParams: { class: 'normal' } });
                }
            }

            return blog;
        });

        const rawLocale = context.req?.headers?.['x-accept-language'];
        const locale = typeof rawLocale === 'string' ? rawLocale.split(',')[0]?.trim() : undefined;
        if (locale && context.req?.sessionPortal !== E_SessionPortal.ADMIN) {
            filteredDocs = filteredDocs.map(doc => localizeDocument(doc, locale));
        }

        // Update result with filtered docs (keep original pagination meta if present)
        blogs.result.docs = filteredDocs;

        return blogs;
    },
    createBlog: async (context: I_Context, { doc }: I_Input_CreateOne<I_Input_CreateBlog>): Promise<I_Return<I_Blog>> => {
        const currentUser = await authnCtr.getUserFromSession(context);

        const authorId = currentUser.id;

        doc.authorId = authorId;
        doc.iframe = normalizePodcastEmbedUrl(doc.iframe);
        if (doc.languageId) {
            const language = await languageCtr.getLanguage(context, { filter: { id: doc.languageId } });
            if (!language.success) {
                throwError({ message: 'Language does not exist', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (doc.relatedBlogsIds?.length) {
            const blogsFound = await blogCtr.getBlogs(context, { filter: { id: { $in: doc.relatedBlogsIds } }, options: { limit: doc.relatedBlogsIds.length } });
            if (!blogsFound.success) {
                throwError({ message: 'Error fetching related blogs', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }
            if (blogsFound.result.docs.length !== doc.relatedBlogsIds.length) {
                throwError({ message: 'One or more relatedBlogsIds do not exist', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (doc.type === 'PODCAST' && !doc.file && !doc.iframe) {
            throwError({ message: 'Podcast requires an uploaded file or an accepted embed URL.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const blogResult = await mongooseCtr.createOne(doc);
        if (!blogResult.success)
            return blogResult;
        const notifType = doc.type === 'PODCAST' ? E_NotificationType.NEW_PODCAST : E_NotificationType.NEW_BLOG_POST;
        const redirectKind = doc.type === 'PODCAST' ? E_RedirectType.PODCAST : E_RedirectType.BLOG;
        const notifEntity = doc.type === 'PODCAST' ? E_NotificationEntityType.PODCAST : E_NotificationEntityType.BLOG;
        // Build correct URL for notification
        let redirectUrl = '';
        if (doc.type === 'PODCAST') {
            redirectUrl = `/blog/podcast/${blogResult.result.slug ?? ''}`;
        }
        else {
            const category = (blogResult.result.category || '').toLowerCase();
            redirectUrl = `/blog/${category}/${blogResult.result.slug}`;
        }

        let thumbnailUrl: string | undefined;
        try {
            if (blogResult.result.featuredImage) {
                thumbnailUrl = bunnyCtr.generateSignedUrl({ fullUrl: blogResult.result.featuredImage, extraQueryParams: { class: 'normal' } });
            }
        }
        catch { }
        try {
            const [adminRole, staffRole] = await Promise.all([
                roleCtr.getRole(context, { filter: { name: E_Role_Staff.ADMIN } }),
                roleCtr.getRole(context, { filter: { name: E_Role.STAFF } }),
            ]);
            const excludeRoleIds = [
                adminRole.success ? adminRole.result.id : undefined,
                staffRole.success ? staffRole.result.id : undefined,
            ].filter(Boolean) as string[];
            const users = await userCtr.getUsers(context, { filter: { isActive: true, ...(excludeRoleIds.length ? { rolesIds: { $nin: excludeRoleIds } } : {}) }, options: { pagination: false } });
            if (users.success && users.result.docs.length > 0) {
                const uniqueTargetIds = [...new Set(users.result.docs.map(u => u.id).filter((id): id is string => !!id && id !== authorId))];
                await Promise.all(uniqueTargetIds.map(targetId =>
                    notificationCtr.createNotificationWithSettings(context, {
                        doc: {
                            targetId,
                            type: [notifType],
                            entityType: notifEntity,
                            entityId: blogResult.result.id,
                            actorId: authorId,
                            presentation: {
                                // Use slug when available so the client can navigate without hitting 404 pages.
                                redirect: { kind: redirectKind, id: blogResult.result.slug, url: redirectUrl },
                                actor: {
                                    username: currentUser.username,
                                    accountType: currentUser.accountType,
                                    avatarUrl: currentUser.partner1?.gallery?.url,
                                    gender: currentUser.partner1?.gender,
                                },
                                thumbnailUrl: blogResult.result.featuredImage ? thumbnailUrl : undefined,
                                headline: typeof blogResult.result.title === 'object' ? (blogResult.result.title?.en ?? blogResult.result.title?.fr ?? blogResult.result.title?.de ?? blogResult.result.title?.da) : blogResult.result.title,
                            },
                        },
                    }),
                ));
            }
        }
        catch { }

        // Trigger background translation
        if (blogResult.success && blogResult.result?.id) {
            translationQueue.add({
                type: 'blog',
                id: blogResult.result.id,
            }).catch(e => log.error('[BlogController] Failed to add translation job to queue:', e));
        }

        return blogResult;
    },
    updateBlog: async (context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_UpdateBlog>): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter });

        if (!blogFound.success) {
            throwError({ message: 'Blog not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const { languageId, relatedBlogsIds } = update;

        if (languageId) {
            const language = await languageCtr.getLanguage(context, { filter: { id: languageId } });
            if (!language) {
                throwError({ message: 'Language does not exist', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (relatedBlogsIds) {
            const blogs = await blogCtr.getBlogs(context, { filter: { id: { $in: relatedBlogsIds } }, options: { limit: relatedBlogsIds?.length } });
            if (!blogs.success) {
                throwError({ message: 'Error fetching related blogs', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
            }

            if (blogs.result.docs.length !== relatedBlogsIds?.length) {
                throwError({ message: 'One or more relatedBlogsIds do not exist', status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (Object.hasOwn(update, 'iframe')) {
            update.iframe = normalizePodcastEmbedUrl(update.iframe);
        }

        const normalizeCdnUrl = (value?: string | null): string | undefined => {
            if (!value)
                return undefined;
            const raw = String(value).trim();
            if (!raw)
                return undefined;
            try {
                const url = new URL(raw);
                return `${url.origin}${url.pathname}`;
            }
            catch {
                const [path] = raw.split('?');
                return path;
            }
        };

        const toStoragePath = (value?: string | null): string | undefined => {
            const normalized = normalizeCdnUrl(value);
            if (!normalized)
                return undefined;
            try {
                const url = new URL(normalized);
                return url.pathname.replace(LEADING_SLASHES_REGEX, '');
            }
            catch {
                return normalized
                    .replace(`${env.BUNNY_CDN_HOSTNAME}/`, '')
                    .replace(LEADING_SLASHES_REGEX, '');
            }
        };

        if (update.featuredImage || update.logo || update.cover || update.file) {
            const existingBlog = await blogCtr.getBlog(context, { filter });
            if (existingBlog.success) {
                const mediaFields: Array<keyof Pick<I_Input_UpdateBlog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

                for (const field of mediaFields) {
                    const incomingRaw = update[field];
                    if (incomingRaw === undefined)
                        continue;

                    const incomingNormalized = normalizeCdnUrl(incomingRaw);
                    const existingNormalized = normalizeCdnUrl(existingBlog.result[field]);

                    // Keep the DB value free from expiring query params.
                    (update as Record<string, unknown>)[field as string] = incomingNormalized ?? incomingRaw ?? null;

                    if (!existingNormalized)
                        continue;

                    if (!incomingNormalized) {
                        const storagePath = toStoragePath(existingNormalized);
                        if (storagePath)
                            await bunnyCtr.deleteFile(context, storagePath);
                        continue;
                    }

                    if (incomingNormalized !== existingNormalized) {
                        const storagePath = toStoragePath(existingNormalized);
                        if (storagePath)
                            await bunnyCtr.deleteFile(context, storagePath);
                    }
                }
            }
        }

        const nextType = update.type ?? blogFound.result.type;
        const nextFile = update.file === undefined ? blogFound.result.file : update.file;
        const nextIframe = update.iframe === undefined ? blogFound.result.iframe : update.iframe;
        if (nextType === 'PODCAST' && !nextFile && !nextIframe) {
            throwError({ message: 'Podcast requires an uploaded file or an accepted embed URL.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const updateResult = await mongooseCtr.updateOne(filter, update, options);
        if (updateResult.success && updateResult.result?.id) {
            translationQueue.add({
                type: 'blog',
                id: updateResult.result.id,
            }).catch(e => log.error('[BlogController] Failed to add translation job to queue:', e));
        }
        return updateResult;
    },
    deleteBlog: async (context: I_Context, { filter, options }: I_Input_DeleteOne<I_Input_QueryBlog>): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter, options });

        if (!blogFound.success) {
            throwError({ message: 'Blog not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const mediaFields: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];

        for (const field of mediaFields) {
            if (blogFound.result[field]) {
                const path = String(blogFound.result[field]).replace(`${env.BUNNY_CDN_HOSTNAME}/`, '');
                await bunnyCtr.deleteFile(context, path);
            }
        }

        return mongooseCtr.deleteOne(filter, options);
    },
    updateReadCount: async (context: I_Context, { filter }: I_Input_FindOne<I_Input_QueryBlog>): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter });

        if (!blogFound.success) {
            throwError({ message: 'Blog not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.updateOne(filter, { $inc: { readCount: 1 } }, { new: true });
    },
};
