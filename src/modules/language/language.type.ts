import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';
import type {
    TLanguageCode,
} from 'countries-list';

export interface I_Language extends I_GenericDocument {
    code?: TLanguageCode;
    name?: string;
    native?: string;
}

export interface I_Input_QueryLanguage extends I_Language { }

export interface I_Input_CreateLanguage extends Omit<I_Language, T_Omit_Create> {}

export interface I_Input_UpdateLanguage extends Omit<I_Language, T_Omit_Update> {}
