import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export interface I_Currency extends I_GenericDocument {
    name?: string;
    code?: string;
    symbol?: string;
}

export interface I_Input_QueryCurrency extends I_Currency { }

export interface I_Input_CreateCurrency extends Omit<I_Currency, T_Omit_Create> {
    name: string;
    code: string;
    symbol: string;
}

export interface I_Input_UpdateCurrency extends Omit<I_Currency, T_Omit_Update> {}
