import type { I_LocalizedString } from '#shared/typescript/index.js';

export interface I_ImageAltText {
    imageUrl: string;
    alt: I_LocalizedString;
}

export interface I_Seo {
    title?: I_LocalizedString;
    description?: I_LocalizedString;
    keywords?: Record<string, string[]>;
    socialImage?: string;
    socialMediaDescription?: I_LocalizedString;
    urlSlug?: string;
    altTextForImages?: I_LocalizedString;
    imageAltTexts?: I_ImageAltText[];
}
