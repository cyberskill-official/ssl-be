import type { E_AccountType, I_Input_UserPartner, I_Input_UserSettings, I_User } from '#modules/user/index.js';

export enum E_RegisterStep {
    VERIFY_EMAIL = 'VERIFY_EMAIL', // Step 2
    PERSONAL_INFO = 'PERSONAL_INFO', // Step 3
    PREFERENCES = 'PREFERENCES', // Step 4
    MEMBERSHIP = 'MEMBERSHIP', // Step 5
    COMPLETE = 'COMPLETE', // Step 6
}

export interface I_SessionPayload {
    createdAt: number;
    userId: string;
}

export interface I_Input_CheckToken {
    token: string;
}

export interface I_Input_CheckAuth {
    token?: string;
}

export interface I_Input_Login {
    identity: string;
    password: string;
    rememberMe?: boolean;
}

export interface I_Input_GuardianLogin {
    token: string;
}

export interface I_Response_Auth {
    user?: Omit<I_User, 'password'>;
    token?: string;
}

// Step 1
export interface I_Input_Register {
    username: string;
    email: string;
    password: string;
    accountType: E_AccountType;
}

// Step 2
export interface I_Input_Register_SendVerifyEmail {
    email: string;
}

export interface I_Input_Register_VerifyEmail {
    email: string;
    otp: string;
}

// Step 3
export interface I_Input_Register_PersonalInfo_Partner extends Pick<I_Input_UserPartner, 'gender' | 'dateOfBirth' | 'location'> {
}

export interface I_Input_Register_Settings extends Pick<I_Input_UserSettings, 'timeFormat'> { }

export interface I_Input_Register_PersonalInfo {
    partner1: I_Input_Register_PersonalInfo_Partner;
    partner2?: I_Input_Register_PersonalInfo_Partner;
    nativeLanguageId: string;
    otherLanguagesIds?: string[];
    settings: I_Input_Register_Settings;
}

// Step 4
export interface I_Input_Register_Preferences_Partner {
    relationshipStatusIds: string[];
    sexualOrientationIds: string[];
    sexualPreferencesIds: string[];
    smokingHabitsIds: string[];
    preferredDrinksIds: string[];
    bodyTypeId: string;
    heightId: string;
    hairColorId: string;
    eyeColorId: string;
    ethnicityId: string;
    galleryId?: string;
    bio?: string;
}

export interface I_Input_Register_Preferences {
    lookingForIds: string[];
    profilePurposeIds: string[];
    willingnessToGoIds: string[];
    rulesOfEngagementIds: string[];
    partner1: I_Input_Register_Preferences_Partner;
    partner2?: I_Input_Register_Preferences_Partner;
}

// Step 5
export enum E_MembershipType {
    FREE = 'FREE',
    PAID = 'PAID',
    PROMO = 'PROMO',
}

export interface I_Input_Register_Membership {
    type: E_MembershipType;
    promoCode?: string;
}

// Verify Age
export enum E_AgeVerifyStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}

export enum E_AgeVerifyMethod {
    PASSPORT = 'PASSPORT',
    ID_CARD = 'ID_CARD',
    DRIVERS_LICENSE = 'DRIVERS_LICENSE',
}

export interface I_AgeRange {
    low?: number;
    high?: number;
}

export interface I_AIVerifyResult {
    documentAge?: number;
    selfieAgeRange?: I_AgeRange;
    similarity?: number;
    isOver18?: boolean;
    dateOfBirth?: Date;
}

export interface I_PreApproval {
    documentPic?: string;
    selfiePic?: string;
    aiResult?: I_AIVerifyResult;
}

export interface I_AgeVerify {
    status?: E_AgeVerifyStatus;
    method?: E_AgeVerifyMethod;
    preApproval?: I_PreApproval;
    approvedById?: string;
    approvedBy?: I_User;
    approvedAt?: Date;
    reason?: string;
    dateOfBirth?: Date;
    agreement?: string;
}

export interface I_Input_ApproveAgeVerify {
    userId: string;
}

export interface I_Input_RejectAgeVerify {
    userId: string;
    reason: string;
}

export interface I_Input_ForgotPasswordRequest {
    email: string;
}

export interface I_Input_ResetPassword {
    email: string;
    otp: string;
    newPassword: string;
}
