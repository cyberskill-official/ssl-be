import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_SocialPlatform } from '#modules/social-platform/index.js';

export interface I_SocialLink {
    type: E_SocialPlatform;
    url: string;
}

export interface I_Footer {
    socialLinks: I_SocialLink[];
}

export interface I_SettingsStoreLink_Response {
    success: boolean;
    message: string;
    result: I_SocialLink[];
}

export interface I_Setting extends I_GenericDocument {
    footer: I_Footer;
}

export interface I_Input_QuerySetting extends I_Setting { }

export interface I_Input_CreateSetting extends Omit<I_Setting, T_Omit_Create> { }

export interface I_Input_UpdateSetting extends Omit<I_Setting, T_Omit_Update> { }
