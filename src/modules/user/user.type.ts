import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Language } from '#modules/language/index.js';
import type { I_Location, T_Location_Populate } from '#modules/location/index.js';
import type { I_Role } from '#modules/role/index.js';
import type { I_Tag } from '#modules/tag/tag.type.js';

export enum E_AccountType {
    SINGLE = 'SINGLE',
    COUPLE = 'COUPLE',
}

export enum E_Gender {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
}
export interface I_UserPartner {
    gender?: E_Gender;
    dateOfBirth?: Date;
    relationshipStatusIds?: string[];
    relationshipStatus?: I_Tag[];
    sexualOrientationIds?: string[];
    sexualOrientation?: I_Tag[];
    sexualPreferencesIds?: string[];
    sexualPreferences?: I_Tag[];
    smokingHabitsIds?: string[];
    smokingHabits?: I_Tag[];
    preferredDrinksIds?: string[];
    preferredDrinks?: I_Tag[];
    bodyTypeId?: string;
    bodyType?: I_Tag;
    heightId?: string;
    height?: I_Tag;
    hairColorId?: string;
    hairColor?: I_Tag;
    eyeColorId?: string;
    eyeColor?: I_Tag;
    skinToneId?: string;
    skinTone?: I_Tag;
    picture?: string;
    bio?: string;
}

export type T_UserPartner_Populate = 'relationshipStatus' | 'sexualOrientation' | 'sexualPreferences' | 'smokingHabits' | 'preferredDrinks' | 'bodyType' | 'height' | 'hairColor' | 'eyeColor' | 'skinTone';

export enum E_PinStyle {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
    COUPLE = 'COUPLE',
    LGBTQ_PLUS = 'LGBTQ+',
}

export interface I_UserSettings_TemporaryLocation {
    location?: I_Location;
    endAt?: Date;
}

export interface I_Input_UserSettings_TemporaryLocation {
    location?: Omit<I_Location, T_Location_Populate>;
    endAt?: Date;
}

export interface I_UserSettings_Notification {
    followingPostAnnouncement?: boolean;
    gainFollower?: boolean;
    receiveMessage?: boolean;
    newMemberJoined?: boolean;
    sound?: boolean;
}

export interface I_UserSettings {
    timeFormat?: string;
    temporaryLocation?: I_UserSettings_TemporaryLocation;
    notification?: I_UserSettings_Notification;
}

export interface I_Input_UserSettings {
    timeFormat?: string;
    temporaryLocation?: I_Input_UserSettings_TemporaryLocation;
    notification?: I_UserSettings_Notification;
}

export interface I_User extends I_GenericDocument {
    username?: string;
    email?: string;
    isEmailVerified?: boolean;
    password?: string;
    displayName?: string;
    accountType?: E_AccountType;
    partner1?: I_UserPartner;
    partner2?: I_UserPartner;
    location?: I_Location;
    nativeLanguageId?: string;
    nativeLanguage?: I_Language;
    otherLanguagesIds?: string[];
    otherLanguages?: I_Language[];
    pinStyle?: E_PinStyle;
    lookingForIds?: string[];
    lookingFor?: I_Tag[];
    profilePurposeIds?: string[];
    profilePurpose?: I_Tag[];
    willingnessToGoIds?: string[];
    willingnessToGo?: I_Tag[];
    rulesOfEngagementIds?: string[];
    rulesOfEngagement?: I_Tag[];
    rolesIds?: string[];
    roles?: I_Role[];
    isActive?: boolean;
    isOnline?: boolean;
    lastOnline?: Date;
    settings?: I_UserSettings;
}

export type T_User_Populate = 'nativeLanguage' | 'otherLanguages' | 'lookingFor' | 'profilePurpose' | 'willingnessToGo' | 'rulesOfEngagement' | 'roles';

export interface I_Input_QueryUser extends Omit<I_User, 'password' | T_User_Populate> {
    partner1?: Omit<I_UserPartner, T_UserPartner_Populate>;
    partner2?: Omit<I_UserPartner, T_UserPartner_Populate>;
    location?: Omit<I_Location, T_Location_Populate>;
    settings?: I_Input_UserSettings;
}

export interface I_Input_CreateUser extends Omit<I_User, T_Omit_Create | T_User_Populate> {
    username: string;
    email: string;
    password: string;
    partner1?: Omit<I_UserPartner, T_UserPartner_Populate>;
    partner2?: Omit<I_UserPartner, T_UserPartner_Populate>;
    location?: Omit<I_Location, T_Location_Populate>;
    settings?: I_Input_UserSettings;
}

export interface I_Input_UpdateUser extends Omit<I_User, T_Omit_Update | T_User_Populate> {
    partner1?: Omit<I_UserPartner, T_UserPartner_Populate>;
    partner2?: Omit<I_UserPartner, T_UserPartner_Populate>;
    location?: Omit<I_Location, T_Location_Populate>;
    settings?: I_Input_UserSettings;
}
