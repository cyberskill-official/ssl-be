import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

export enum E_TagType {
    LOOKING_FOR = 'LOOKING_FOR',
    PROFILE_PURPOSE = 'PROFILE_PURPOSE',
    WILLINGNESS_TO_GO = 'WILLINGNESS_TO_GO',
    RULES_OF_ENGAGEMENT = 'RULES_OF_ENGAGEMENT',
    RELATIONSHIP_STATUS = 'RELATIONSHIP_STATUS',
    SEXUAL_ORIENTATION = 'SEXUAL_ORIENTATION',
    SEXUAL_PREFERENCES = 'SEXUAL_PREFERENCES',
    SMOKING_HABITS = 'SMOKING_HABITS',
    PREFERRED_DRINKS = 'PREFERRED_DRINKS',
    BODY_TYPE = 'BODY_TYPE',
    HEIGHT = 'HEIGHT',
    HAIR_COLOR = 'HAIR_COLOR',
    EYE_COLOR = 'EYE_COLOR',
    SKIN_TONE = 'SKIN_TONE',
    CATALOGUE = 'CATALOGUE',
}

export interface I_Tag extends I_GenericDocument {
    name?: string;
    type?: E_TagType;
    isCustom?: boolean;
    createdById?: string;
    createdBy?: I_User;
    usageCount?: number;
}

export type T_Tag_Populate = 'createdBy';

export interface I_Input_QueryTag extends Omit<I_Tag, T_Tag_Populate> { }

export interface I_Input_CreateTag extends Omit<I_Tag, T_Omit_Create | T_Tag_Populate> {
    name: string;
}

export interface I_Input_UpdateTag extends Omit<I_Tag, T_Omit_Update | T_Tag_Populate> {}
