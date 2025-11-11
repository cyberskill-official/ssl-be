import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_RegisterStep, I_AgeVerify } from '#modules/authn/index.js';
import type { I_Role } from '#modules/authz/index.js';
import type { I_Gallery } from '#modules/gallery/index.js';
import type { I_Language } from '#modules/language/index.js';
import type { I_Location } from '#modules/location/index.js';
import type { I_Input_Note, I_Note } from '#modules/note/index.js';
import type { I_Tag } from '#modules/tag/index.js';
import type { T_UploadedFilePromise } from '#modules/upload/upload.type.js';

export enum E_AccountType {
    SINGLE = 'SINGLE',
    SINGLE_MALE = 'SINGLE_MALE',
    SINGLE_FEMALE = 'SINGLE_FEMALE',
    COUPLE = 'COUPLE',
}

export enum E_Gender {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
}

export enum E_UserSettings_TimeFormat {
    H24 = 'H24',
    H12 = 'H12',
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
    ethnicityId?: string;
    ethnicity?: I_Tag;
    galleryId?: string;
    gallery?: I_Gallery;
    locationId?: string;
    location?: I_Location;
    bio?: string;
}

export type T_UserPartner_Populate = 'relationshipStatus' | 'sexualOrientation' | 'sexualPreferences' | 'smokingHabits' | 'preferredDrinks' | 'bodyType' | 'height' | 'hairColor' | 'eyeColor' | 'ethnicity';

export interface I_Input_UserPartner extends Omit<I_UserPartner, T_UserPartner_Populate> {
}

export interface I_UserSettings_TemporaryLocation {
    locationId?: string;
    location?: I_Location;
    endAt?: Date;
}

export interface I_Input_UserSettings_TemporaryLocation extends I_UserSettings_TemporaryLocation {
    location: I_Location;
    endAt: Date;
}

export interface I_UserSettings_Notification {
    followingPostAnnouncement?: boolean;
    gainFollower?: boolean;
    receiveMessage?: boolean;
    newMemberJoined?: boolean;
    sound?: boolean;
}

export interface I_UserSettings {
    timeFormat?: E_UserSettings_TimeFormat;
    temporaryLocation?: I_UserSettings_TemporaryLocation;
    notification?: I_UserSettings_Notification;
    zoomLevel?: number;
}

export interface I_Input_UserSettings {
    timeFormat?: E_UserSettings_TimeFormat;
    temporaryLocation?: I_Input_UserSettings_TemporaryLocation;
    notification?: I_UserSettings_Notification;
    zoomLevel?: number;
}

export interface I_User extends I_GenericDocument {
    username?: string;
    email?: string;
    password?: string;
    rolesIds?: string[];
    registerStep?: E_RegisterStep;
    isEmailVerified?: boolean;
    ageVerify?: I_AgeVerify;
    accountType?: E_AccountType;
    partner1?: I_UserPartner;
    partner2?: I_UserPartner;
    nativeLanguageId?: string;
    nativeLanguage?: I_Language;
    otherLanguagesIds?: string[];
    otherLanguages?: I_Language[];
    lookingForIds?: string[];
    lookingFor?: I_Tag[];
    profilePurposeIds?: string[];
    profilePurpose?: I_Tag[];
    willingnessToGoIds?: string[];
    willingnessToGo?: I_Tag[];
    rulesOfEngagementIds?: string[];
    rulesOfEngagement?: I_Tag[];
    roles?: I_Role[];
    isActive?: boolean;
    isOnline?: boolean;
    lastOnline?: Date;
    lastLoginIp?: string;
    settings?: I_UserSettings;
    flagCount?: number;
    hasUpcomingEvent?: boolean;
    membershipExpiresAt?: Date;
    inactivityDeletionWarning30SentAt?: Date | null;
    inactivityDeletionWarning10SentAt?: Date | null;
    followerCount?: number;
    followingCount?: number;
    isAdminBlocked?: boolean;
    isGuardianView?: boolean;
    guardianOwnerId?: string | null;
    notes?: I_Note[];
}

export type T_User_Populate = 'nativeLanguage' | 'otherLanguages' | 'lookingFor' | 'profilePurpose' | 'willingnessToGo' | 'rulesOfEngagement' | 'roles' | 'notes';

export interface I_Input_QueryUser extends Omit<I_User, 'password' | T_User_Populate> {
    partner1?: I_Input_UserPartner;
    partner2?: I_Input_UserPartner;
    settings?: I_Input_UserSettings;
    notes?: I_Input_Note[];
}

export interface I_Input_CreateUser extends Omit<I_User, T_Omit_Create | T_User_Populate> {
    username: string;
    email: string;
    password: string;
    partner1?: I_Input_UserPartner;
    partner2?: I_Input_UserPartner;
    settings?: I_Input_UserSettings;
    notes?: I_Input_Note[];
}

export interface I_Input_UpdateUser extends Omit<I_User, T_Omit_Update | T_User_Populate> {
    partner1?: I_Input_UserPartner;
    partner2?: I_Input_UserPartner;
    settings?: I_Input_UserSettings;
    notes?: I_Input_Note[];
}

export interface I_Input_UploadUserAvatar {
    file: T_UploadedFilePromise | T_UploadedFilePromise[];
}

export interface I_Input_AdminBlockUser {
    userId: string;
}

export interface I_Input_AdminUnBlockUser {
    userId: string;
}
