import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Input_Location, I_Location } from '#modules/location/index.js';
import type { I_Rating } from '#modules/rating/index.js';
import type { I_Seo } from '#modules/seo/index.js';
import type { I_User } from '#modules/user/user.type.js';

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
    A18_25 = '18-25',
    A26_35 = '26-35',
    A36_45 = '36-45',
    A45_PLUS = '45+',
}

export interface I_Hotel {
    name?: string;
    address?: string;
    location?: I_Location;
    url?: string;
    description?: string;
    image?: string;
}

export interface I_Input_Hotel extends I_Hotel {
    location?: I_Input_Location;
}

export interface I_Destination extends I_GenericDocument {
    type?: E_DestinationType;
    name?: string;
    address?: string;
    websiteURL?: string;
    rating?: E_DestinationRating;
    images?: string[];
    introductionHeadline?: string;
    introductionContent?: string;
    ageGroup?: E_DestinationAgeGroup;
    logo?: string;
    location?: I_Location;
    nearbyHotels?: I_Hotel[];
    wearImage?: string;
    womenDressCode?: string;
    menDressCode?: string;
    useDefaultText?: boolean;
    atmosphereRating?: I_Rating;
    guestsRating?: I_Rating;
    facilitiesRating?: I_Rating;
    serviceRating?: I_Rating;
    xFactorRating?: I_Rating;
    highlightSex?: string;
    highlightWellness?: string;
    highlightBar?: string;
    highlightDance?: string;
    seo?: I_Seo;
    linkTo?: string;
    isActive?: boolean;
    createdById?: string;
    createdBy?: I_User;
}

export type T_Destination_Populate = 'createdBy';

export interface I_Input_QueryDestination extends Omit<I_Destination, T_Destination_Populate> {
    location?: I_Input_Location;
    nearbyHotels?: I_Input_Hotel[];
}

export interface I_Input_CreateDestination extends Omit<I_Destination, T_Omit_Create | T_Destination_Populate> {
    type: E_DestinationType;
    name: string;
    address: string;
    websiteURL: string;
    rating: E_DestinationRating;
    images: string[];
    introductionHeadline: string;
    introductionContent: string;
    ageGroup: E_DestinationAgeGroup;
    location?: I_Input_Location;
    nearbyHotels?: I_Input_Hotel[];
}

export interface I_Input_UpdateDestination extends Omit<I_Destination, T_Omit_Update | T_Destination_Populate> {
    location?: I_Input_Location;
    nearbyHotels?: I_Input_Hotel[];
}
