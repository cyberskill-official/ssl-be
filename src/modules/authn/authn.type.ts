import type { E_AccountType, E_PinStyle, I_Input_UpdateUser, I_Input_UserPartner, I_Input_UserSettings, I_User } from '#modules/user/index.js';

export interface I_SessionPayload {
    createdAt: number;
    userId: string;
}

export interface I_Input_CheckToken {
    token: string;
}

export interface I_Input_CheckAuth {
    token: string;
}

export interface I_Input_Login {
    identity: string;
    password: string;
    rememberMe?: boolean;
}

export interface I_Response_Auth {
    success: boolean;
    message?: string;
    result?: {
        user?: Omit<I_User, 'password'>;
        token?: string;
    };
}

export interface I_Input_Register {
    displayName: string;
    username: string;
    email: string;
    password: string;
    accountType: E_AccountType;
}

export interface I_Input_InitiateRegister extends Pick<I_Input_Register, 'email' | 'username'> { }

export interface I_Input_VerifyEmail {
    email: string;
    otp: string;
    userData: Omit<I_Input_Register, 'email'>;
}

export interface I_Input_PartnerInfoS2 extends Pick<I_Input_UserPartner, 'gender' | 'dateOfBirth'> { }

export interface I_Input_LocationInfoS2 {
    countryId: string;
}

export interface I_Input_UserSettingsS2 extends Pick<I_Input_UserSettings, 'timeFormat'> { }

export interface I_Input_CompleteProfileS2 extends Pick<
    I_Input_UpdateUser,
    'partner1' | 'partner2' | 'location' | 'nativeLanguageId' | 'otherLanguagesIds' | 'settings' | 'pinStyle'
> {
    partner1: I_Input_PartnerInfoS2;
    partner2: I_Input_PartnerInfoS2;
    location: I_Input_LocationInfoS2;
    nativeLanguageId: string;
    otherLanguagesIds: string[];
    settings: I_Input_UserSettingsS2;
    pinStyle: E_PinStyle;
}

export interface I_Input_PartnerInfoS3 extends Pick<
    I_Input_UserPartner,
    | 'relationshipStatusIds'
    | 'sexualOrientationIds'
    | 'sexualPreferencesIds'
    | 'smokingHabitsIds'
    | 'preferredDrinksIds'
    | 'bodyTypeId'
    | 'heightId'
    | 'hairColorId'
    | 'eyeColorId'
    | 'skinToneId'
    | 'picture'
    | 'bio'
> { }

export interface I_Input_CompleteProfileS3 extends Pick<
    I_Input_UpdateUser,
    'lookingForIds' | 'profilePurposeIds' | 'willingnessToGoIds' | 'rulesOfEngagementIds' | 'partner1' | 'partner2'
> {
    lookingForIds: string[];
    profilePurposeIds: string[];
    willingnessToGoIds: string[];
    rulesOfEngagementIds: string[];
    partner1: I_Input_PartnerInfoS3;
    partner2: I_Input_PartnerInfoS3;
}
export enum E_MembershipType {
    FREE = 'FREE',
    PAID = 'PAID',
    PROMO = 'PROMO',
}

export interface I_Input_ChooseMembership {
    type: E_MembershipType;
    promoCode?: string;
}

export interface I_Input_ForgotPasswordRequest {
    email: string;
}

export interface I_Input_ResetPassword {
    email: string;
    otp: string;
    newPassword: string;
}
