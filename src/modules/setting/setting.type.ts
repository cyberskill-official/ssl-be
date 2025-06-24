import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_SocialPlatform } from '#modules/social-platform/index.js';

export enum E_SettingType {
    FOOTER = 'FOOTER',
    ADMIN_NOTIFICATION = 'ADMIN_NOTIFICATION',
}

export interface I_SocialLink {
    type: E_SocialPlatform;
    url: string;
}

export interface I_Footer {
    socialLinks?: I_SocialLink[];
}

export interface I_AdminNotification {
    successfulPayments?: boolean;
    failedPayments?: boolean;
    newMembers?: boolean;
}

export interface I_Setting extends I_GenericDocument {
    type: E_SettingType;
    value: I_Footer | I_AdminNotification;
}

export interface I_GraphQLSettingValue {
    footer?: I_Footer;
    adminNotification?: I_AdminNotification;
}

export interface I_GraphQLSetting extends I_GenericDocument {
    type: E_SettingType;
    value: I_GraphQLSettingValue;
}

export interface I_Input_QuerySetting extends I_Setting { }

export interface I_Input_CreateSetting extends Omit<I_Setting, T_Omit_Create> { }

export interface I_Input_UpdateSetting extends Omit<I_Setting, T_Omit_Update> { }

export interface I_Input_QuerySettingGraphQL extends I_GraphQLSetting { }

export interface I_Input_CreateSettingGraphQL extends Omit<I_GraphQLSetting, T_Omit_Create> { }

export interface I_Input_UpdateSettingGraphQL extends Omit<I_GraphQLSetting, T_Omit_Update> { }
