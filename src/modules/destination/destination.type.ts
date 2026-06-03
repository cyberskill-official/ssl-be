import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Location } from '#modules/location/index.js';
import type { I_Rating } from '#modules/rating/index.js';
import type { I_Seo } from '#modules/seo/index.js';
import type { I_User } from '#modules/user/index.js';
import type { I_LocalizedString } from '#shared/typescript/index.js';

export enum E_DestinationType {
    CLUB = 'CLUB',
    RESORT = 'RESORT',
}

export enum E_DestinationRating {
    BRONZE = 'BRONZE',
    SILVER = 'SILVER',
    GOLD = 'GOLD',
}

export enum E_DestinationAgeGroup {
    A18_25 = 'A18_25',
    A26_35 = 'A26_35',
    A36_45 = 'A36_45',
    A45_PLUS = 'A45_PLUS',
}

export interface I_Hotel {
    name?: I_LocalizedString;
    locationId?: string;
    location?: I_Location;
    url?: string;
    description?: I_LocalizedString;
    image?: string;
}

export interface I_Destination extends I_GenericDocument {
    type?: E_DestinationType;
    name?: I_LocalizedString;
    slug?: I_LocalizedString;
    websiteURL?: string;
    rating?: E_DestinationRating;
    images?: string[];
    introductionHeadline?: I_LocalizedString;
    introductionContent?: I_LocalizedString;
    introductionContentPlain?: string;
    ageGroup?: E_DestinationAgeGroup;
    ratingStar?: string;
    logo?: string;
    locationId?: string;
    location?: I_Location;
    nearbyHotels?: I_Hotel[];
    wearImage?: string;
    womenDressCode?: I_LocalizedString;
    menDressCode?: I_LocalizedString;
    useDefaultText?: boolean;
    atmosphereRating?: I_Rating;
    guestsRating?: I_Rating;
    facilitiesRating?: I_Rating;
    serviceRating?: I_Rating;
    xFactorRating?: I_Rating;
    highlightSex?: I_LocalizedString;
    highlightWellness?: I_LocalizedString;
    highlightBar?: I_LocalizedString;
    highlightDance?: I_LocalizedString;
    seo?: I_Seo;
    faqs?: Array<{
        question: I_LocalizedString;
        answer: I_LocalizedString;
    }>;
    linkTo?: string;
    isActive?: boolean;
    createdById?: string;
    createdBy?: I_User;
    translationSnapshot?: Record<string, any>;
}

export type T_Destination_Populate = 'createdBy';

export interface I_Input_QueryDestination extends Omit<I_Destination, T_Destination_Populate> {
    countryId?: string;
}

export interface I_Input_CreateDestination extends Omit<I_Destination, T_Omit_Create | T_Destination_Populate> {
    type: E_DestinationType;
    name: I_LocalizedString;
    websiteURL: string;
    rating: E_DestinationRating;
    images: string[];
    introductionHeadline: I_LocalizedString;
    introductionContent: I_LocalizedString;
    ageGroup: E_DestinationAgeGroup;
    isActive: boolean;
}

export interface I_Input_UpdateDestination extends Omit<I_Destination, T_Omit_Update | T_Destination_Populate> {
}

export interface I_DestinationCountrySummary {
    id: string;
    name: string;
}

export interface I_DestinationCountriesSummary {
    club: number;
    resort: number;
    total: number;
    countries: I_DestinationCountrySummary[];
    countriesTotal: number;
}

export interface I_Input_QueryDestinationSummary {
    filter?: Partial<Omit<I_Destination, T_Destination_Populate>> & { countryName?: string };
}
