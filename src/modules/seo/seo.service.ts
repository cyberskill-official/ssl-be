import { log } from '@cyberskill/shared/node/log';

import { BlogModel } from '#modules/blog/blog.model.js';
import { DestinationModel } from '#modules/destination/destination.model.js';
import { E_DestinationType } from '#modules/destination/destination.type.js';
import { EventModel } from '#modules/event/event.model.js';
import { getEnv } from '#shared/env/index.js';

const env = getEnv();

const SUPPORTED_LOCALES: readonly string[] = ['en', 'da', 'de', 'fr', 'es', 'pl', 'it', 'pt', 'pt-BR', 'ko', 'hi', 'vi'];

function getLocalizedValue(obj: Record<string, any> | undefined, locale: string): string | undefined {
    if (!obj || typeof obj !== 'object')
        return undefined;
    return obj[locale] ?? obj['en'] ?? undefined;
}

function escapeXml(str: string): string {
    return str
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&apos;');
}

function toDateString(date: Date | string | undefined): string {
    const d = date ? new Date(date) : new Date();
    return d.toISOString().split('T')[0] ?? d.toISOString().slice(0, 10);
}

// --- Static Page SEO ---

const STATIC_PAGE_SEO: Record<string, { title: Record<string, string>; description: Record<string, string> }> = {
    home: {
        title: {
            en: 'Best Worldwide Swinger Community – Profiles, Clubs & Events',
        },
        description: {
            en: 'Discover swinger profiles, clubs, resorts, and events worldwide. Connect, explore, and experience the lifestyle.',
        },
    },
    destination: {
        title: {
            en: 'Best Swinger Destinations in the World – Luxury Lifestyle Travel Guide',
        },
        description: {
            en: 'Explore the best swinger destinations in the world, from Cap d\'Agde and Gran Canaria to Cancun, Amsterdam, Paris and other exclusive lifestyle travel hotspots for open-minded couples.',
        },
    },
    blog: {
        title: {
            en: 'The Swinger Blog – Your Guide to the Swinger Lifestyle',
        },
        description: {
            en: 'Explore guides, real experiences, and insights into the swinger lifestyle. Learn, discover, and get inspired.',
        },
    },
};

export function getStaticPageSeo(page: string, locale: string): { title: string; description: string; canonicalUrl: string; hreflangLinks: Array<{ hreflang: string; href: string }> } | null {
    const pageData = STATIC_PAGE_SEO[page];
    if (!pageData)
        return null;

    const baseUrl = env.USER_APP_URL.replace(/\/$/u, '');
    const title = pageData.title[locale] ?? pageData.title['en'] ?? '';
    const description = pageData.description[locale] ?? pageData.description['en'] ?? '';
    const canonicalUrl = `${baseUrl}/${locale}/${page}`;

    const hreflangLinks = SUPPORTED_LOCALES.map(loc => ({
        hreflang: loc,
        href: `${baseUrl}/${loc}/${page}`,
    }));
    hreflangLinks.push({ hreflang: 'x-default', href: `${baseUrl}/en/${page}` });

    return { title, description, canonicalUrl, hreflangLinks };
}

// --- robots.txt ---

export function generateRobotsTxt(): string {
    const sitemapUrl = `${env.USER_APP_URL}/sitemap.xml`;
    return `User-agent: *
Allow: /

Sitemap: ${sitemapUrl}`;
}

// --- sitemap.xml ---

interface SitemapEntry {
    loc: string;
    lastmod: string;
    hreflangLinks: Array<{ hreflang: string; href: string }>;
}

export async function generateSitemap(): Promise<string> {
    const baseUrl = env.USER_APP_URL.replace(/\/$/u, '');
    const entries: SitemapEntry[] = [];

    // Static pages
    const staticPages = ['home', 'destination', 'blog'];
    for (const page of staticPages) {
        const hreflangLinks = SUPPORTED_LOCALES.map(locale => ({
            hreflang: locale,
            href: `${baseUrl}/${locale}/${page}`,
        }));
        hreflangLinks.push({ hreflang: 'x-default', href: `${baseUrl}/en/${page}` });

        entries.push({
            loc: `${baseUrl}/en/${page}`,
            lastmod: toDateString(new Date()),
            hreflangLinks,
        });
    }

    // Blogs
    try {
        const blogs = await BlogModel.find({ isActive: true, isDel: { $ne: true } })
            .select('slug updatedAt category')
            .lean()
            .exec();

        for (const blog of blogs) {
            if (!blog.slug)
                continue;

            const category = (blog.category || '').toLowerCase();
            const hreflangLinks = SUPPORTED_LOCALES.map(locale => ({
                hreflang: locale,
                href: `${baseUrl}/${locale}/blog/${category}/${blog.slug}`,
            }));
            hreflangLinks.push({ hreflang: 'x-default', href: `${baseUrl}/en/blog/${category}/${blog.slug}` });

            entries.push({
                loc: `${baseUrl}/en/blog/${category}/${blog.slug}`,
                lastmod: toDateString(blog.updatedAt),
                hreflangLinks,
            });
        }
    }
    catch (error) {
        log.error('[SEO] Error fetching blogs for sitemap:', error);
    }

    // Destinations
    try {
        const destinations = await DestinationModel.find({ isActive: true, isDel: { $ne: true } })
            .select('slug updatedAt type')
            .lean()
            .exec();

        for (const dest of destinations) {
            if (!dest.slug)
                continue;

            const pathSegment = dest.type === E_DestinationType.CLUB ? 'club' : 'resort';
            const hreflangLinks = SUPPORTED_LOCALES.map(locale => ({
                hreflang: locale,
                href: `${baseUrl}/${locale}/${pathSegment}/${dest.slug}`,
            }));
            hreflangLinks.push({ hreflang: 'x-default', href: `${baseUrl}/en/${pathSegment}/${dest.slug}` });

            entries.push({
                loc: `${baseUrl}/en/${pathSegment}/${dest.slug}`,
                lastmod: toDateString(dest.updatedAt),
                hreflangLinks,
            });
        }
    }
    catch (error) {
        log.error('[SEO] Error fetching destinations for sitemap:', error);
    }

    // Events
    try {
        const events = await EventModel.find({ isActive: true, isDel: { $ne: true } })
            .select('slug updatedAt')
            .lean()
            .exec();

        for (const event of events) {
            if (!event.slug)
                continue;

            const hreflangLinks = SUPPORTED_LOCALES.map(locale => ({
                hreflang: locale,
                href: `${baseUrl}/${locale}/event/${event.slug}`,
            }));
            hreflangLinks.push({ hreflang: 'x-default', href: `${baseUrl}/en/event/${event.slug}` });

            entries.push({
                loc: `${baseUrl}/en/event/${event.slug}`,
                lastmod: toDateString(event.updatedAt),
                hreflangLinks,
            });
        }
    }
    catch (error) {
        log.error('[SEO] Error fetching events for sitemap:', error);
    }

    // Build XML
    const urls = entries.map((entry) => {
        const alternateLinks = entry.hreflangLinks
            .map(link => `    <xhtml:link rel="alternate" hreflang="${escapeXml(link.hreflang)}" href="${escapeXml(link.href)}" />`)
            .join('\n');

        return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
${alternateLinks}
  </url>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`;
}

// --- Hreflang ---

export function generateHreflangLinks(slug: string, contentType: string): Array<{ hreflang: string; href: string }> {
    const baseUrl = env.USER_APP_URL.replace(/\/$/u, '');
    const links = SUPPORTED_LOCALES.map(locale => ({
        hreflang: locale,
        href: `${baseUrl}/${locale}/${contentType}/${slug}`,
    }));
    links.push({ hreflang: 'x-default', href: `${baseUrl}/en/${contentType}/${slug}` });
    return links;
}

// --- Canonical URL ---

export function generateCanonicalUrl(slug: string, contentType: string, locale: string): string {
    const baseUrl = env.USER_APP_URL.replace(/\/$/u, '');
    return `${baseUrl}/${locale}/${contentType}/${slug}`;
}

// --- JSON-LD Structured Data ---

export function generateBlogStructuredData(blog: any, locale: string): Record<string, any>[] {
    const baseUrl = env.USER_APP_URL.replace(/\/$/u, '');
    const blogUrl = `${baseUrl}/${locale}/blog/${(blog.category || '').toLowerCase()}/${blog.slug}`;
    const schemas: Record<string, any>[] = [];

    // BreadcrumbList
    schemas.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': 1,
                'name': 'Home',
                'item': `${baseUrl}/${locale}/home`,
            },
            {
                '@type': 'ListItem',
                'position': 2,
                'name': 'Blog',
                'item': `${baseUrl}/${locale}/blog`,
            },
            {
                '@type': 'ListItem',
                'position': 3,
                'name': getLocalizedValue(blog.title, locale) ?? blog.slug,
                'item': blogUrl,
            },
        ],
    });

    // Article
    const description = blog.seo?.description
        ? getLocalizedValue(blog.seo.description, locale)
        : undefined;

    const articleSchema: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        'headline': getLocalizedValue(blog.title, locale) ?? blog.slug,
        'url': blogUrl,
        'mainEntityOfPage': {
            '@type': 'WebPage',
            '@id': blogUrl,
        },
        'datePublished': blog.createdAt ? new Date(blog.createdAt).toISOString() : undefined,
        'dateModified': blog.updatedAt ? new Date(blog.updatedAt).toISOString() : undefined,
        'publisher': {
            '@type': 'Organization',
            'name': 'Secret Swinger Lust',
            'url': baseUrl,
        },
    };

    if (description) {
        articleSchema['description'] = description;
    }
    if (blog.featuredImage) {
        articleSchema['image'] = blog.featuredImage;
    }
    if (blog.authorName) {
        articleSchema['author'] = {
            '@type': 'Person',
            'name': blog.authorName,
        };
    }

    schemas.push(articleSchema);

    // FAQPage
    if (blog.faqs?.length) {
        schemas.push({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            'mainEntity': blog.faqs.map((faq: any) => ({
                '@type': 'Question',
                'name': getLocalizedValue(faq.question, locale) ?? '',
                'acceptedAnswer': {
                    '@type': 'Answer',
                    'text': getLocalizedValue(faq.answer, locale) ?? '',
                },
            })),
        });
    }

    return schemas;
}

export function generateDestinationStructuredData(destination: any, locale: string): Record<string, any>[] {
    const baseUrl = env.USER_APP_URL.replace(/\/$/u, '');
    const pathSegment = destination.type === E_DestinationType.CLUB ? 'club' : 'resort';
    const destUrl = `${baseUrl}/${locale}/${pathSegment}/${destination.slug}`;
    const schemas: Record<string, any>[] = [];

    // BreadcrumbList
    schemas.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': 1,
                'name': 'Home',
                'item': `${baseUrl}/${locale}/home`,
            },
            {
                '@type': 'ListItem',
                'position': 2,
                'name': 'Destinations',
                'item': `${baseUrl}/${locale}/destination`,
            },
            {
                '@type': 'ListItem',
                'position': 3,
                'name': getLocalizedValue(destination.name, locale) ?? destination.slug,
                'item': destUrl,
            },
        ],
    });

    // LocalBusiness (NightClub or LodgingBusiness)
    const schemaType = destination.type === E_DestinationType.CLUB ? 'NightClub' : 'LodgingBusiness';
    const description = destination.seo?.description
        ? getLocalizedValue(destination.seo.description, locale)
        : getLocalizedValue(destination.introductionHeadline, locale);

    const businessSchema: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': schemaType,
        'name': getLocalizedValue(destination.name, locale) ?? destination.slug,
        'url': destUrl,
        '@id': destUrl,
    };

    if (description) {
        businessSchema['description'] = description;
    }
    if (destination.images?.length) {
        businessSchema['image'] = destination.images;
    }
    if (destination.logo) {
        businessSchema['logo'] = destination.logo;
    }
    if (destination.websiteURL) {
        businessSchema['sameAs'] = destination.websiteURL;
    }

    // Rating
    if (destination.ratingStar) {
        const starNum = Number.parseFloat(destination.ratingStar);
        if (!Number.isNaN(starNum)) {
            businessSchema['aggregateRating'] = {
                '@type': 'AggregateRating',
                'ratingValue': starNum,
                'bestRating': 5,
                'worstRating': 1,
            };
        }
    }

    schemas.push(businessSchema);

    // FAQPage
    if (destination.faqs?.length) {
        schemas.push({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            'mainEntity': destination.faqs.map((faq: any) => ({
                '@type': 'Question',
                'name': getLocalizedValue(faq.question, locale) ?? '',
                'acceptedAnswer': {
                    '@type': 'Answer',
                    'text': getLocalizedValue(faq.answer, locale) ?? '',
                },
            })),
        });
    }

    return schemas;
}

export function generateEventStructuredData(event: any, locale: string): Record<string, any>[] {
    const baseUrl = env.USER_APP_URL.replace(/\/$/u, '');
    const eventUrl = `${baseUrl}/${locale}/event/${event.slug}`;
    const schemas: Record<string, any>[] = [];

    // BreadcrumbList
    schemas.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {
                '@type': 'ListItem',
                'position': 1,
                'name': 'Home',
                'item': `${baseUrl}/${locale}/home`,
            },
            {
                '@type': 'ListItem',
                'position': 2,
                'name': 'Events',
                'item': `${baseUrl}/${locale}/home`,
            },
            {
                '@type': 'ListItem',
                'position': 3,
                'name': getLocalizedValue(event.title, locale) ?? event.slug,
                'item': eventUrl,
            },
        ],
    });

    // Event schema
    const description = event.seo?.description
        ? getLocalizedValue(event.seo.description, locale)
        : getLocalizedValue(event.description, locale);

    const eventSchema: Record<string, any> = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        'name': getLocalizedValue(event.title, locale) ?? event.slug,
        'url': eventUrl,
        'startDate': event.startDate ? new Date(event.startDate).toISOString() : undefined,
        'endDate': event.endDate ? new Date(event.endDate).toISOString() : undefined,
        'eventAttendanceMode': 'https://schema.org/OfflineEventAttendanceMode',
        'eventStatus': 'https://schema.org/EventScheduled',
        'organizer': {
            '@type': 'Organization',
            'name': 'Secret Swinger Lust',
            'url': baseUrl,
        },
    };

    if (description) {
        eventSchema['description'] = description;
    }
    if (event.image) {
        eventSchema['image'] = event.image;
    }

    schemas.push(eventSchema);

    // FAQPage
    if (event.faqs?.length) {
        schemas.push({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            'mainEntity': event.faqs.map((faq: any) => ({
                '@type': 'Question',
                'name': getLocalizedValue(faq.question, locale) ?? '',
                'acceptedAnswer': {
                    '@type': 'Answer',
                    'text': getLocalizedValue(faq.answer, locale) ?? '',
                },
            })),
        });
    }

    return schemas;
}
