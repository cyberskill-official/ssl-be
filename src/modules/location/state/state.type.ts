import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_Country } from '../country/index.js';

export interface I_State extends I_GenericDocument {
    name?: string;
    countryId?: string;
    country?: I_Country;
    code?: string;
    type?: string;
    latitude?: string;
    longitude?: string;
}

export type T_State_Populate = 'country';

export interface I_Input_QueryState extends Omit<I_State, T_State_Populate> { }

export interface I_Input_CreateState extends Omit<I_State, T_Omit_Create | T_State_Populate> {
    userId: string;
    followId: string;
}

export interface I_Input_UpdateState extends Omit<I_State, T_Omit_Update | T_State_Populate> {}
