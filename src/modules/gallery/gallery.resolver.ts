import type {
    I_Input_FindOne,
    I_Input_FindPaging,
} from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { queryCacheService } from '#shared/redis/query-cache.service.js';

import type {
    I_Input_QueryDashboardGalleryInViewport,
    I_Input_QueryGallery,
} from './gallery.type.js';

import { galleryCtr } from './gallery.controller.js';

const DASHBOARD_GALLERY_CACHE_TTL_SECONDS = 60;

function getViewerCacheId(context: I_Context): string {
    return context.req?.session?.user?.id ?? 'guest';
}

function isSuccessfulGalleryPage(value: unknown): boolean {
    return Boolean(
        value
        && typeof value === 'object'
        && 'success' in value
        && (value as { success?: boolean }).success === true,
    );
}

const galleryResolver = {
    Query: {
        getGallery: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryGallery>, context: I_Context) =>
            galleryCtr.getGallery(context, args),
        getGalleries: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryGallery>, context: I_Context) =>
            galleryCtr.getGalleries(context, args),
        getGalleriesByUserIds: (
            _parent: unknown,
            args: { filter: I_Input_QueryGallery; options?: I_Input_FindPaging<I_Input_QueryGallery> },
            context: I_Context,
        ) => galleryCtr.getGalleriesByUserIds(context, args),
        getDashboardGalleriesInViewport: (
            _parent: unknown,
            args: { filter: I_Input_QueryDashboardGalleryInViewport; options?: I_Input_FindPaging<I_Input_QueryGallery> },
            context: I_Context,
        ) => queryCacheService.getOrSet({
            scope: 'dashboard:getDashboardGalleriesInViewport',
            key: { viewerId: getViewerCacheId(context), args },
            ttl: DASHBOARD_GALLERY_CACHE_TTL_SECONDS,
            dependencies: ['gallery', 'location', 'user', 'like'],
            shouldCache: isSuccessfulGalleryPage,
            loader: () => galleryCtr.getDashboardGalleriesInViewport(context, args),
        }),

    },
    Mutation: {
        deleteGallery: (_parent: unknown, { id }: { id: string }, context: I_Context) =>
            galleryCtr.deleteGallery(context, { filter: { id } }),
        deleteOwnGallery: (_parent: unknown, { id }: { id: string }, context: I_Context) =>
            galleryCtr.deleteOwnGallery(context, { id }),
    },
};

export default galleryResolver;
