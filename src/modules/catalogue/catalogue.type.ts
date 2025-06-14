import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_Tag } from '#modules/tag/tag.type.js';

export enum E_CatalogueType {
    IMAGE = 'IMAGE',
    VIDEO = 'VIDEO',
}

export interface I_Catalogue_PayLoad {
    type?: E_CatalogueType;
    tagId?: string;
    tag?: I_Tag;
    url?: string;
}

export interface I_Catalogue extends I_Catalogue_PayLoad, I_GenericDocument { }

export interface I_Input_QueryCatalogue extends I_Catalogue { }

export interface I_Input_MutateCatalogue extends Omit<I_Catalogue, 'id' | 'createdAt' | 'updatedAt' | 'tag'> { }
