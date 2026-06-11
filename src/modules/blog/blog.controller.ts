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
import { queryCacheService } from '#shared/redis/query-cache.service.js';
import { E_SessionPortal } from '#shared/session/session.constant.js';
import { getBlockedUserIds, localizeDocument } from '#shared/util/index.js';

import type { I_Blog, I_Input_CreateBlog, I_Input_QueryBlog, I_Input_UpdateBlog } from './blog.type.js';

import { BlogTranslationModel } from '../translation/blog-translation.model.js';
import { translationQueue } from '../translation/translation.queue.js';
import { BLOG_MULTILINGUAL_LOCALES, prepareBlogListQuery } from './blog-list-query.js';
import { prepareBlogLookupFilter } from './blog-query.js';
import { normalizePodcastEmbedUrl } from './blog.embed.js';
import { BlogModel } from './blog.model.js';

const env = getEnv();
const LEADING_SLASHES_REGEX = /^\/+/u;
const BLOG_IMAGE_FIELDS: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];
const BLOG_TRANSLATION_TOP_FIELDS = ['title', 'slug', 'contentHeadline', 'contentSubHeadline', 'content'] as const;
const BLOG_TRANSLATION_ALL_FIELDS = [...BLOG_TRANSLATION_TOP_FIELDS, 'seo', 'faqs'] as const;
const BLOG_DASHBOARD_TRANSLATION_FIELDS = ['title', 'slug', 'contentHeadline'] as const;
const BLOG_DASHBOARD_SUMMARY_PROJECTION = 'id createdAt updatedAt title slug type category featuredImage contentHeadline authorId';

type T_BlogTranslationField = typeof BLOG_TRANSLATION_ALL_FIELDS[number];

function signBlogImageUrls(blog: I_Blog): I_Blog {
    for (const field of BLOG_IMAGE_FIELDS) {
        if (blog[field]) {
            blog[field] = bunnyCtr.generateSignedUrl({ fullUrl: blog[field]!, extraQueryParams: { class: 'normal' } });
        }
    }

    return blog;
}

function normalizeSeoKeywords(blog: Record<string, any>): void {
    if (blog['seo']?.keywords && typeof blog['seo'].keywords === 'object') {
        const kw = blog['seo'].keywords;
        blog['seo'].keywords = typeof kw.en === 'string' ? kw.en : (typeof kw['0'] === 'string' ? kw['0'] : String(Object.values(kw).find((v: unknown) => typeof v === 'string') || ''));
    }
}

function getEn(val: unknown): string {
    if (typeof val === 'object' && val)
        return (val as Record<string, string>)['en'] || '';
    return typeof val === 'string' ? val : '';
}

/**
 * Merge external translations (stored in BlogTranslation collection, one
 * document per language) back into the blog document before localization.
 */
async function mergeExternalTranslations(doc: Record<string, any>): Promise<void> {
    const uuidId = doc['id'];
    const objectId = doc['_id']?.toString();
    // BlogTranslationModel may have been keyed with either the UUID (id field)
    // or ObjectId hex string (_id field). Query both to avoid missing translations.
    const blogIdCandidates = [uuidId, objectId].filter(Boolean) as string[];
    if (!blogIdCandidates.length)
        return;

    const extDocs = await BlogTranslationModel.find({ blogId: { $in: blogIdCandidates } }).lean();
    if (!extDocs.length)
        return;

    // Merge each language's translations into the doc
    for (const ext of extDocs) {
        const lang = ext.lang;
        const t = ext.translations as Record<string, any>;
        if (!t)
            continue;

        // Merge top-level multilingual fields
        const topFields = ['title', 'slug', 'contentHeadline', 'contentSubHeadline', 'content'];
        for (const field of topFields) {
            if (t[field] !== undefined && t[field] !== null) {
                if (!doc[field] || typeof doc[field] !== 'object') {
                    // Preserve the English (en) original before converting to multilingual object
                    const enOriginal = typeof doc[field] === 'string' ? doc[field] : undefined;
                    doc[field] = {};
                    if (enOriginal)
                        doc[field]['en'] = enOriginal;
                }
                doc[field][lang] = t[field];
            }
        }

        // Merge nested SEO fields
        if (t['seo']) {
            if (!doc['seo'] || typeof doc['seo'] !== 'object') {
                doc['seo'] = {};
            }
            const seoExt = t['seo'] as Record<string, any>;
            for (const [seoField, val] of Object.entries(seoExt)) {
                if (val !== undefined && val !== null) {
                    if (!doc['seo'][seoField] || typeof doc['seo'][seoField] !== 'object') {
                        doc['seo'][seoField] = {};
                    }
                    doc['seo'][seoField][lang] = val;
                }
            }
        }

        // Merge FAQ translations
        if (t['faqs'] && Array.isArray(t['faqs'])) {
            const faqArr = t['faqs'] as Array<Record<string, any>>;
            if (!doc['faqs'] || !Array.isArray(doc['faqs'])) {
                doc['faqs'] = [];
            }
            for (let i = 0; i < faqArr.length; i++) {
                const faqExt = faqArr[i];
                if (!faqExt)
                    continue;
                if (!doc['faqs'][i]) {
                    doc['faqs'][i] = { question: {}, answer: {} };
                }
                for (const subField of ['question', 'answer']) {
                    if (faqExt[subField] !== undefined && faqExt[subField] !== null) {
                        if (!doc['faqs'][i][subField] || typeof doc['faqs'][i][subField] !== 'object') {
                            doc['faqs'][i][subField] = {};
                        }
                        doc['faqs'][i][subField][lang] = faqExt[subField];
                    }
                }
            }
        }
    }
}

/**
 * Batch-merge external translations for multiple blog documents.
 * Used by getBlogs to avoid N+1 queries.
 */
async function batchMergeExternalTranslations(
    docs: Record<string, any>[],
    fields: readonly T_BlogTranslationField[] = BLOG_TRANSLATION_ALL_FIELDS,
): Promise<void> {
    if (docs.length === 0)
        return;

    // Collect both UUID (id) and ObjectId (_id) candidates for each doc
    const blogIdCandidates: string[] = [];
    for (const d of docs) {
        const uuidId = d['id'];
        const objectId = d['_id']?.toString();
        if (uuidId)
            blogIdCandidates.push(uuidId);
        if (objectId && objectId !== uuidId)
            blogIdCandidates.push(objectId);
    }
    if (blogIdCandidates.length === 0)
        return;

    const fieldSet = new Set(fields);
    const projection = fields.reduce<Record<string, 1>>(
        (acc, field) => {
            acc[`translations.${field}`] = 1;
            return acc;
        },
        { blogId: 1, lang: 1 },
    );
    const extDocs = await BlogTranslationModel.find({ blogId: { $in: blogIdCandidates } }, projection).lean();
    // Group by blogId: { blogId -> { lang -> translations } }
    const extMap = new Map<string, Record<string, Record<string, any>>>();
    for (const ext of extDocs) {
        if (!extMap.has(ext.blogId)) {
            extMap.set(ext.blogId, {});
        }
        extMap.get(ext.blogId)![ext.lang] = ext.translations as Record<string, any>;
    }

    for (const doc of docs) {
        const blogId = doc['id'] || doc['_id']?.toString();
        if (!blogId)
            continue;
        const langMap = extMap.get(blogId);
        if (!langMap)
            continue;

        // Merge each language's translations
        for (const [lang, t] of Object.entries(langMap)) {
            if (!t)
                continue;

            const topFields = BLOG_TRANSLATION_TOP_FIELDS.filter(field => fieldSet.has(field));
            for (const field of topFields) {
                if (t[field] !== undefined && t[field] !== null) {
                    if (!doc[field] || typeof doc[field] !== 'object') {
                        // Preserve the English (en) original before converting to multilingual object
                        const enOriginal = typeof doc[field] === 'string' ? doc[field] : undefined;
                        doc[field] = {};
                        if (enOriginal)
                            doc[field]['en'] = enOriginal;
                    }
                    doc[field][lang] = t[field];
                }
            }

            if (fieldSet.has('seo') && t['seo']) {
                if (!doc['seo'] || typeof doc['seo'] !== 'object') {
                    const enSeo = typeof doc['seo'] === 'object' ? doc['seo'] : undefined;
                    doc['seo'] = enSeo ? { ...enSeo } : {};
                }
                const seoExt = t['seo'] as Record<string, any>;
                for (const [seoField, val] of Object.entries(seoExt)) {
                    if (val !== undefined && val !== null) {
                        if (!doc['seo'][seoField] || typeof doc['seo'][seoField] !== 'object') {
                            const enSeoField = typeof doc['seo'][seoField] === 'string' ? doc['seo'][seoField] : undefined;
                            doc['seo'][seoField] = {};
                            if (enSeoField)
                                doc['seo'][seoField]['en'] = enSeoField;
                        }
                        doc['seo'][seoField][lang] = val;
                    }
                }
            }

            if (fieldSet.has('faqs') && t['faqs'] && Array.isArray(t['faqs'])) {
                const faqArr = t['faqs'] as Array<Record<string, any>>;
                if (!doc['faqs'] || !Array.isArray(doc['faqs'])) {
                    doc['faqs'] = [];
                }
                for (let i = 0; i < faqArr.length; i++) {
                    const faqExt = faqArr[i];
                    if (!faqExt)
                        continue;
                    if (!doc['faqs'][i]) {
                        doc['faqs'][i] = { question: {}, answer: {} };
                    }
                    for (const subField of ['question', 'answer']) {
                        if (faqExt[subField] !== undefined && faqExt[subField] !== null) {
                            if (!doc['faqs'][i][subField] || typeof doc['faqs'][i][subField] !== 'object') {
                                doc['faqs'][i][subField] = {};
                            }
                            doc['faqs'][i][subField][lang] = faqExt[subField];
                        }
                    }
                }
            }
        }
    }
}

const MULTILINGUAL_FIELDS = new Set(['slug', 'title']);

function normalizeMultilingualFilter(filter: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!filter)
        return {};
    const normalized: Record<string, unknown> = {};
    const orConditions: Record<string, unknown>[] = [];

    for (const [key, value] of Object.entries(filter)) {
        if (MULTILINGUAL_FIELDS.has(key) && typeof value === 'string') {
            // Match both multilingual objects AND plain strings (pre-translation fallback)
            orConditions.push({ [key]: value });
            orConditions.push(
                ...BLOG_MULTILINGUAL_LOCALES.map(locale => ({
                    [`${key}.${locale}`]: value,
                })),
            );
        }
        else {
            normalized[key] = value;
        }
    }

    if (orConditions.length > 0) {
        const existingOr = Array.isArray(filter['$or']) ? filter['$or'] as Record<string, unknown>[] : [];
        normalized['$or'] = [...existingOr, ...orConditions];
    }

    return normalized;
}

const mongooseCtr = new MongooseController<I_Blog>(BlogModel);
export const blogCtr = {
    getBlog: async (_context: I_Context, { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryBlog>): Promise<I_Return<I_Blog>> => {
        const normalizedFilter = normalizeMultilingualFilter(filter as Record<string, unknown> | undefined);
        const lookupFilter = prepareBlogLookupFilter(normalizedFilter);
        let blogFound = await mongooseCtr.findOne(lookupFilter, projection, options, populate);

        // Fallback: if slug-based lookup failed, the blog may have its translations
        // (including slug) stored externally in BlogTranslationModel. Search there
        // and retry with the blogId. This is a safety net for blogs translated before
        // inline slug/title backfill was added to saveTranslationsExternal.
        if (!blogFound.success && typeof (filter as Record<string, unknown> | undefined)?.['slug'] === 'string') {
            const slugValue = (filter as Record<string, string>)['slug']!;
            const extDoc = await BlogTranslationModel.findOne({
                'translations.slug': slugValue,
            }).lean();
            if (extDoc) {
                log.info(`[BlogController] Blog found via external slug translation lookup: "${slugValue}" → ${extDoc.blogId}`);
                // Use blogId + the original filter conditions (except the slug $or which already failed)
                const cleanFilter: Record<string, unknown> = {};
                for (const [key, value] of Object.entries(normalizedFilter)) {
                    if (key !== '$or')
                        cleanFilter[key] = value;
                }
                blogFound = await mongooseCtr.findOne(
                    { id: extDoc.blogId, ...cleanFilter },
                    projection,
                    options,
                    populate,
                );
            }
        }

        if (!blogFound.success) {
            return blogFound;
        }

        const imageFields: Array<keyof Pick<I_Blog, 'featuredImage' | 'logo' | 'cover' | 'file'>> = ['featuredImage', 'logo', 'cover', 'file'];
        for (const field of imageFields) {
            if (blogFound.result[field]) {
                blogFound.result[field] = bunnyCtr.generateSignedUrl({ fullUrl: blogFound.result[field]!, extraQueryParams: { class: 'normal' } });
            }
        }

        // Merge external translations (for oversized blogs) before localization
        await mergeExternalTranslations(blogFound.result as any);

        // Preserve raw multilingual slug for SEO (hreflang, canonicalUrl) before localization
        const rawSlug = (blogFound.result as any).slug;
        const rawLocale = _context.req?.headers?.['x-accept-language'];
        const locale = typeof rawLocale === 'string' ? rawLocale.split(',')[0]?.trim() : undefined;
        const isAdmin = _context.req?.sessionPortal === E_SessionPortal.ADMIN;
        if (isAdmin) {
            // Admin editors expect English strings, not multilingual objects.
            // Localize to 'en' so title/slug/contentHeadline/contentSubHeadline/content
            // render correctly in the blog edit form.
            blogFound.result = localizeDocument(blogFound.result, 'en');
        }
        else if (locale) {
            blogFound.result = localizeDocument(blogFound.result, locale);
        }

        // Fix seo.keywords: if it's still an object (e.g. {0:"...", en:"...", da:"..."}),
        // extract the en/English string so GraphQL receives the expected String type.
        // The "0" key (from array-to-object conversion) breaks isLocalizedStringObject detection.
        const blogResult = blogFound.result as any;
        if (blogResult.seo?.keywords && typeof blogResult.seo.keywords === 'object') {
            const kw = blogResult.seo.keywords;
            blogResult.seo.keywords = typeof kw.en === 'string' ? kw.en : (typeof kw['0'] === 'string' ? kw['0'] : String(Object.values(kw).find((v: unknown) => typeof v === 'string') || ''));
        }

        // Re-attach raw slug for SEO resolvers to generate per-locale URLs
        if (rawSlug && typeof rawSlug === 'object') {
            (blogFound.result as any)._rawSlug = rawSlug;
        }

        return blogFound;
    },
    getBlogs: async (context: I_Context, { filter, options }: I_Input_FindPaging<I_Input_QueryBlog>): Promise<I_Return<T_PaginateResult<I_Blog>>> => {
        const normalizedFilter = normalizeMultilingualFilter(filter as Record<string, unknown> | undefined);
        const effectiveFilter: Record<string, unknown> = { ...(normalizedFilter ?? {}) };
        const efAny = effectiveFilter as Record<string, any>;
        if (efAny['isDel'] === undefined) {
            efAny['isDel'] = { $ne: true };
        }

        const rawOptions = (options ?? {}) as Record<string, unknown>;
        const { dashboardSummary, ...queryOptions } = rawOptions;
        const isDashboardSummary = dashboardSummary === true;
        const preparedQuery = prepareBlogListQuery(
            effectiveFilter,
            queryOptions,
        );
        const pagingOptions = isDashboardSummary
            ? (({ pagination: _pagination, ...summaryOptions }) => ({
                    ...summaryOptions,
                    projection: BLOG_DASHBOARD_SUMMARY_PROJECTION,
                }))(preparedQuery.options)
            : preparedQuery.options;
        const blogs = await mongooseCtr.findPaging(
            preparedQuery.filter as Parameters<typeof mongooseCtr.findPaging>[0],
            pagingOptions as Parameters<typeof mongooseCtr.findPaging>[1],
        );

        if (!blogs.success)
            return blogs;

        const isAdmin = context.req?.sessionPortal === E_SessionPortal.ADMIN;

        // ADMIN fast path: skip blocking, skip signed URLs (they expire), skip translation merge
        if (isAdmin) {
            blogs.result.docs = blogs.result.docs.map((blog) => {
                // Still sign image URLs so the admin panel can display them
                signBlogImageUrls(blog);
                // Fix seo.keywords: object → string for GraphQL String type
                normalizeSeoKeywords(blog as any);
                return blog;
            });
            return blogs;
        }

        // --- User path below (all the heavy operations) ---

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

        filteredDocs = filteredDocs.map(signBlogImageUrls);

        // Merge external translations (for oversized blogs) before localization
        await batchMergeExternalTranslations(
            filteredDocs as any,
            isDashboardSummary ? BLOG_DASHBOARD_TRANSLATION_FIELDS : BLOG_TRANSLATION_ALL_FIELDS,
        );

        const rawLocale = context.req?.headers?.['x-accept-language'];
        const locale = typeof rawLocale === 'string' ? rawLocale.split(',')[0]?.trim() : undefined;
        // Note: isAdmin fast-returns above (line ~338), so we only reach here for non-admin users
        if (locale) {
            filteredDocs = filteredDocs.map((doc) => {
                const rawSlug = (doc as any).slug;
                const localized = localizeDocument(doc, locale);
                if (rawSlug && typeof rawSlug === 'object') {
                    (localized as any)._rawSlug = rawSlug;
                }
                // Fix seo.keywords: object → string
                if ((localized as any).seo?.keywords && typeof (localized as any).seo.keywords === 'object') {
                    normalizeSeoKeywords(localized as any);
                }
                return localized;
            });
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
                                redirect: { kind: redirectKind, id: getEn(blogResult.result.slug), url: redirectUrl },
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

        await queryCacheService.bumpVersion('blog');
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

        const getLocalizedValue = (val: unknown): string => {
            if (typeof val === 'object' && val !== null)
                return (val as Record<string, string>)['en'] ?? (val as Record<string, string>)['fr'] ?? (val as Record<string, string>)['de'] ?? (val as Record<string, string>)['da'] ?? '';
            return typeof val === 'string' ? val : '';
        };

        const requiredLocalizedFields: Array<{ field: string; label: string }> = [
            { field: 'title', label: 'title' },
            { field: 'contentHeadline', label: 'content headline' },
            { field: 'contentSubHeadline', label: 'content sub headline' },
            { field: 'content', label: 'content' },
        ];

        for (const { field, label } of requiredLocalizedFields) {
            if (Object.hasOwn(update, field) && !getLocalizedValue((update as Record<string, unknown>)[field]).trim()) {
                throwError({ message: `Blog ${label} cannot be empty`, status: RESPONSE_STATUS.BAD_REQUEST });
            }
        }

        if (Object.hasOwn(update, 'featuredImage') && !(update as Record<string, unknown>)['featuredImage']) {
            throwError({ message: 'Blog featured image cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (Object.hasOwn(update, 'type') && !(update as Record<string, unknown>)['type']) {
            throwError({ message: 'Blog type cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (Object.hasOwn(update, 'category') && !(update as Record<string, unknown>)['category']) {
            throwError({ message: 'Blog category cannot be empty', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const updateResult = await mongooseCtr.updateOne(
            prepareBlogLookupFilter(filter as Record<string, unknown>) as Parameters<typeof mongooseCtr.updateOne>[0],
            update,
            options,
        );
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

        const result = await mongooseCtr.deleteOne(
            prepareBlogLookupFilter(filter as Record<string, unknown>) as Parameters<typeof mongooseCtr.deleteOne>[0],
            options,
        );
        if (result.success) {
            await queryCacheService.bumpVersion('blog');
        }
        return result;
    },
    updateReadCount: async (context: I_Context, { filter }: I_Input_FindOne<I_Input_QueryBlog>): Promise<I_Return<I_Blog>> => {
        const blogFound = await blogCtr.getBlog(context, { filter });

        if (!blogFound.success) {
            throwError({ message: 'Blog not found.', status: RESPONSE_STATUS.NOT_FOUND });
        }
        return mongooseCtr.updateOne(
            prepareBlogLookupFilter(filter as Record<string, unknown>) as Parameters<typeof mongooseCtr.updateOne>[0],
            { $inc: { readCount: 1 } },
            { new: true },
        );
    },
};
