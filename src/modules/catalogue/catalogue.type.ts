import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Tag } from '#modules/tag/index.js';

export enum E_CatalogueType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export interface I_Catalogue extends I_GenericDocument {
    type?: E_CatalogueType;
    tagId?: string;
    tag?: I_Tag;
    url?: string;
}

export type T_Catalogue_Populate = 'tag';

export interface I_Input_QueryCatalogue extends Omit<I_Catalogue, T_Catalogue_Populate> { }

export interface I_Input_CreateCatalogue extends Omit<I_Catalogue, T_Omit_Create | T_Catalogue_Populate> {
    type: E_CatalogueType;
    tagId: string;
    url: string;
}

export interface I_Input_UpdateCatalogue extends Omit<I_Catalogue, T_Omit_Update | T_Catalogue_Populate> {}
