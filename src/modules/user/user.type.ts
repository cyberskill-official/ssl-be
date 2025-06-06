import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Country } from '#modules/country/index.js';
import type { I_Role } from '#modules/role/index.js';
import type { I_Tag } from '#modules/tag/tag.type.js';

export enum E_PinStyle {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
    COUPLE = 'COUPLE',
    LGBTQ_PLUS = 'LGBTQ+',
}
export enum E_AccountType {
    SINGLE = 'SINGLE',
    COUPLE = 'COUPLE',
}
export interface I_User_Payload {
    username?: string;
    email?: string;
    isEmailVerified?: boolean;
    password?: string;
    displayName?: string;
    accountType?: E_AccountType;
    partner1?: I_Partner;
    partner2?: I_Partner;
    cityId?: string;
    nativeLanguage?: string;
    otherLanguages?: string[];
    avatar?: string;
    phoneNumber?: string;
    settings?: I_Setting[];
    pinStyle?: E_PinStyle;
    location?: Record<string, any>;
    lookingFor?: string[];
    profilePurpose?: string[];
    willingnessToGo?: string[];
    rulesOfEngagement?: string[];
    roleId?: string;
    role?: I_Role;
}

export interface I_User extends I_GenericDocument, I_User_Payload { }

export interface I_Input_QueryUser extends Omit<I_User, 'password' | 'role'> { }

export interface I_Input_MutateUser extends Omit<I_User, 'id' | 'createdAt' | 'updatedAt' | 'role'> { }

export enum E_PartnerGender {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
}
export interface I_Partner_Payload {
    gender?: E_PartnerGender; // enum
    dateOfBirth?: Date;
    countryId?: string;
    country?: I_Country;
    relationshipStatus?: I_Tag[];
    relationshipStatusIds?: string[];
    sexualOrientation?: I_Tag[];
    sexualOrientationIds?: string[];
    sexualPreferences?: I_Tag[];
    sexualPreferencesIds?: string[];
    smokingHabits?: I_Tag[];
    smokingHabitsIds?: string[];
    preferredDrinks?: I_Tag[];
    preferredDrinksIds?: string[];
    bodyType?: I_Tag;
    bodyTypeId?: string;
    heightRange?: I_Tag;
    heightRangeId?: string;
    hairColor?: I_Tag;
    hairColorId?: string;
    eyeColor?: I_Tag;
    eyeColorId?: string;
    skinTone?: I_Tag;
    skinToneId?: string;
    picture: string;
    bio?: string;
}

export interface I_Partner extends I_GenericDocument, I_Partner_Payload { }

export interface I_Setting_Payload {
    timeFormat?: string; // hh:mm a for 12h, HH:mm for 24h
}

export interface I_Setting extends I_GenericDocument, I_Setting_Payload { }
