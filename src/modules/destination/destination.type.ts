import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Country } from '#modules/country/index.js';
import type { I_User } from '#modules/user/user.type.js';

export enum E_AgeRange {
    A18_25 = '18-25',
    A26_35 = '26-35',
    A36_45 = '36-45',
    A45_PLUS = '45+',
}

export enum E_Rating {
    BRONZE = 'BRONZE',
    SILVER = 'SILVER',
    GOLD = 'GOLD',
}

export enum E_DestinationType {
    CLUB = 'CLUB',
    RESORT = 'RESORT',
}

export interface I_Hotel extends I_GenericDocument {
    name?: string;
    address?: string;
    countryId?: string;
    country?: I_Country;
    url?: string;
    description?: string;
    image?: string;
}

export interface I_DestinationRating {
    rate?: number;
    reason?: string;
    translations: JSON;
}

export interface I_Seo extends I_GenericDocument {
    title?: string;
    description?: string;
    keywords?: string[];
    socialImage?: string;
    socialMediaDescription?: string;
    urlSlug?: string;
    altTextForImages?: string;
}

export interface I_Destination_PayLoad {
    type?: E_DestinationType;
    name?: string;
    countryId?: string;
    country?: I_Country;
    address?: string;
    websiteURL?: string;
    ageGroup?: E_AgeRange;
    logo?: string;
    location?: JSON;
    nearbyHotels?: I_Hotel[];
    wearImage?: string;
    womenDressCode?: string;
    menDressCode?: string;
    userDefaultText?: boolean;
    rating?: E_Rating;
    images?: string[];
    introductionHeadline?: string;
    introductionContent?: string;
    atmosphereRating?: I_DestinationRating;
    guestsRating?: I_DestinationRating;
    facilitiesRating?: I_DestinationRating;
    serviceRating?: I_DestinationRating;
    xFactorRating?: I_DestinationRating;
    highlightSex?: string;
    highlightWellness?: string;
    highlightBar?: string;
    highlightDance?: string;
    seo?: I_Seo;
    linkTo?: string;
    isActive?: boolean;
    createdById?: string;
    createdBy?: I_User;
    translations?: JSON;
}

export interface I_Destination extends I_GenericDocument, I_Destination_PayLoad { }

export interface I_Input_QueryDestination extends I_Destination { }

export interface I_Input_MutationDestination extends Omit<I_Destination, 'id' | 'createAt' | 'updateAt' | 'country' | 'user'> { }
