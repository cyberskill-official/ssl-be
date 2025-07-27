import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Language } from '#modules/language/index.js';
import type { I_Seo } from '#modules/seo/index.js';
import type { I_SocialLink } from '#modules/setting/index.js';
import type { I_User } from '#modules/user/index.js';

export enum E_BlogType {
    BLOG = 'BLOG',
    PODCAST = 'PODCAST',
}

export enum E_BlogCategory {
    TRAVELS = 'TRAVELS',
    SWINGER_CLUB = 'SWINGER_CLUB',
    SEX = 'SEX',
    DATING = 'DATING',
    LIFESTYLE = 'LIFESTYLE',
    RELATIONSHIPS = 'RELATIONSHIPS',
    SEXUALITY = 'SEXUALITY',
    TRAVEL = 'TRAVEL',
}

export interface I_Blog extends I_GenericDocument {
    title?: string;
    authorName?: string;
    websiteName?: string;
    websiteURL?: string;
    type?: E_BlogType;
    category?: E_BlogCategory;
    featuredImage?: string;
    contentHeadline?: string;
    contentSubHeadline?: string;
    content?: string;
    relatedBlogsIds?: string[];
    relatedBlogs?: I_Blog[];
    languageId?: string;
    language?: I_Language;
    hostName?: string;
    logo?: string;
    cover?: string;
    file?: string;
    socialLinks?: I_SocialLink[];
    authorId?: string;
    author?: I_User;
    seo?: I_Seo;
    isActive?: boolean;
    readcount: number;
    isLustEditorial: boolean;
}

export type T_Blog_Populate = 'relatedBlogs' | 'language' | 'author';

export interface I_Input_QueryBlog extends Omit<I_Blog, T_Blog_Populate> { }

export interface I_Input_CreateBlog extends Omit<I_Blog, T_Omit_Create | T_Blog_Populate> {
    title: string;
    authorName: string;
    websiteName: string;
    websiteURL: string;
    type: E_BlogType;
    category: E_BlogCategory;
    featuredImage: string;
    contentHeadline: string;
    contentSubHeadline: string;
    content: string;
}

export interface I_Input_UpdateBlog extends Omit<I_Blog, T_Omit_Update | T_Blog_Populate> { }
