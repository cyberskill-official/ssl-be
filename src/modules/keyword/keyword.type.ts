import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export enum E_KeywordCategory {
    INAPPROPRIATE = 'INAPPROPRIATE',
    SPAM = 'SPAM',
    OFFENSIVE = 'OFFENSIVE',
    CUSTOM = 'CUSTOM',
}

export interface I_Keyword extends I_GenericDocument {
    word?: string;
    category?: E_KeywordCategory;
    occurrences?: number;
    isActive?: boolean;
}

export interface I_Input_QueryKeyword extends I_Keyword { }

export interface I_Input_CreateKeyword extends Omit<I_Keyword, T_Omit_Create> {
    word: string;
    category: E_KeywordCategory;
}

export interface I_Input_UpdateKeyword extends Omit<I_Keyword, T_Omit_Update> { }
