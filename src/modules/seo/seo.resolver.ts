import type { I_Context } from '#shared/typescript/index.js';

import { E_DestinationType } from '#modules/destination/destination.type.js';
import { E_SessionPortal } from '#shared/session/index.js';

import { generateBlogStructuredData, generateDestinationStructuredData, generateHreflangLinks, getStaticPageSeo } from './seo.service.js';

function getLocale(context: I_Context): string {
    const rawLocale = context.req?.headers?.['x-accept-language'];
    const locale = typeof rawLocale === 'string' ? rawLocale.split(',')[0]?.trim() : undefined;
    return locale && context.req?.sessionPortal !== E_SessionPortal.ADMIN ? locale : 'en';
}

const PAGE_MAP: Record<string, string> = {
    HOME: 'home',
    DESTINATION: 'destination',
    BLOG: 'blog',
};

const seoResolver = {
    Query: {
        getStaticPageSeo: (_parent: unknown, args: { page: string }, context: I_Context) => {
            const page = PAGE_MAP[args.page];
            if (!page)
                return null;
            const locale = getLocale(context);
            return getStaticPageSeo(page, locale);
        },
    },
    T_Blog: {
        hreflangLinks: (parent: any, _args: unknown, _context: I_Context) => {
            const slug = parent._rawSlug || parent.slug;
            if (!slug)
                return [];
            const category = (parent.category || '').toLowerCase();
            return generateHreflangLinks(slug, `blog/${category}`);
        },
        structuredData: (parent: any, _args: unknown, context: I_Context) => {
            const slug = parent._rawSlug || parent.slug;
            if (!slug)
                return null;
            const locale = getLocale(context);
            return generateBlogStructuredData(parent, locale);
        },
    },
    T_Destination: {
        hreflangLinks: (parent: any, _args: unknown, _context: I_Context) => {
            const slug = parent._rawSlug || parent.slug;
            if (!slug)
                return [];
            const pathSegment = parent.type === E_DestinationType.CLUB ? 'club' : 'resort';
            return generateHreflangLinks(slug, pathSegment);
        },
        structuredData: (parent: any, _args: unknown, context: I_Context) => {
            const slug = parent._rawSlug || parent.slug;
            if (!slug)
                return null;
            const locale = getLocale(context);
            return generateDestinationStructuredData(parent, locale);
        },
    },
};

export default seoResolver;
