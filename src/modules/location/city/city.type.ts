import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Country } from '../country/index.js';
import type { I_State } from '../state/index.js';

export interface I_City extends I_GenericDocument {
    name?: string;
    stateId?: string;
    state?: I_State;
    countryId?: string;
    country?: I_Country;
    latitude?: string;
    longitude?: string;
    wikiDataId?: string;
}

export type T_City_Populate = 'state' | 'country';

export interface I_Input_QueryCity extends Omit<I_City, T_City_Populate> { }

export interface I_Input_CreateCity extends Omit<I_City, T_Omit_Create | T_City_Populate> {}

export interface I_Input_UpdateCity extends Omit<I_City, T_Omit_Update | T_City_Populate> {}
