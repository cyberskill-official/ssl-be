import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export interface I_Region extends I_GenericDocument {
    name?: string;
    wikiDataId?: string;
}

export interface I_Input_QueryRegion extends I_Region { }

export interface I_Input_CreateRegion extends Omit<I_Region, T_Omit_Create> {}

export interface I_Input_UpdateRegion extends Omit<I_Region, T_Omit_Update> {}
