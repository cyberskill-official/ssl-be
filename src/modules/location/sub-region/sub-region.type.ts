import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Region } from '../region/index.js';

export interface I_SubRegion extends I_GenericDocument {
    name?: string;
    regionId?: string;
    region?: I_Region;
    wikiDataId?: string;
}

export type T_SubRegion_Populate = 'region';

export interface I_Input_QuerySubRegion extends Omit<I_SubRegion, T_SubRegion_Populate> { }

export interface I_Input_CreateSubRegion extends Omit<I_SubRegion, T_Omit_Create | T_SubRegion_Populate> {
    userId: string;
    followId: string;
}

export interface I_Input_UpdateSubRegion extends Omit<I_SubRegion, T_Omit_Update | T_SubRegion_Populate> {}
