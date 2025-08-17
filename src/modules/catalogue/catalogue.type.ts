import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { E_ModerationMediaStatus, I_ModerationMedia } from '#modules/moderation/index.js';
import type { I_Tag } from '#modules/tag/index.js';

export enum E_CatalogueType {
    BOOTYCALL = 'BOOTYCALL',
    PARTY = 'PARTY',
    TRAVEL = 'TRAVEL',
}

export interface I_Catalogue extends I_GenericDocument {
    type?: E_CatalogueType;
    tagId?: string;
    tag?: I_Tag;
    url?: string;
    moderationMediaId?: string;
    moderationMedia?: I_ModerationMedia;
    status?: E_ModerationMediaStatus;
}

export type T_Catalogue_Populate = 'moderationMedia' | 'tag';

export interface I_Input_QueryCatalogue extends Omit<I_Catalogue, T_Catalogue_Populate> { }

export interface I_Input_CreateCatalogue extends Omit<I_Catalogue, T_Omit_Create | T_Catalogue_Populate> {
    type: E_CatalogueType;
    tagId: string;
    url: string;
}

export interface I_Input_UpdateCatalogue extends Omit<I_Catalogue, T_Omit_Update | T_Catalogue_Populate> { }
