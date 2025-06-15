import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Language } from '#modules/country/country.type.js';
import type { I_Seo } from '#modules/seo/index.js';
import type { I_User } from '#modules/user/user.type.js';

export enum E_CategoryBlog {
    TRAVELS = 'TRAVELS',
    SWINGER_CLUB = 'SWINGER_CLUB',
    SEX = 'SEX',
    DATING = 'DATING',
    LIFESTYLE = 'LIFESTYLE',
}

export enum E_CategoryPodcast {
    LIFESTYLE = 'LIFESTYLE',
    RELATIONSHIPS = 'RELATIONSHIPS',
    DATING = 'DATING',
    SEXUALITY = 'SEXUALITY',
    TRAVEL = 'TRAVEL',
}

export enum E_SocialPlatform {
    FACEBOOK = 'FACEBOOK',
    TWITTER = 'TWITTER',
    INSTAGRAM = 'INSTAGRAM',
    LINKEDIN = 'LINKEDIN',
    TIKTOK = 'TIKTOK',
    YOUTUBE = 'YOUTUBE',
    PINTEREST = 'PINTEREST',
    SNAPCHAT = 'SNAPCHAT',
    REDDIT = 'REDDIT',
    TUMBLR = 'TUMBLR',
    MEDIUM = 'MEDIUM',
    VIMEO = 'VIMEO',
}

export interface I_Blog_PayLoad {
    title?: string;
    languageId?: string;
    language: I_Language;
    authorName?: string;
    hostName?: string;
    websiteName?: string;
    websiteURL?: string;
    publishDate?: Date;
    category: E_CategoryBlog | E_CategoryPodcast;
    featuredImage?: string;
    logo?: string;
    cover?: string;
    file?: string;
    contentHeadline?: string;
    contentSubHeadline?: string;
    content?: string;
    relatedArticles?: string[];
    socialPlatform?: E_SocialPlatform;
    socialURL?: string;
    authorProfileId?: string;
    author: I_User;
    seo?: I_Seo;
}

export interface I_Blog extends I_Blog_PayLoad, I_GenericDocument { }

export interface I_QueryBlog extends I_Blog { }

export interface I_MutateBlog extends Omit<I_Blog, 'id' | 'createdAt' | 'updatedAt' | 'language' | 'author'> { }
