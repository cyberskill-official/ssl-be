import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export enum E_CategoryKeyword {
    INAPPROPRIATE = 'INAPPROPRIATE',
    SPAM = 'SPAM',
    OFFENSIVE = 'OFFENSIVE',
    CUSTOM = 'CUSTOM',
}

export interface I_Keyword_PayLoad {
    keyword: string;
    category: E_CategoryKeyword;
    occurrences: number;
    isActive: boolean;
}

export interface I_Keyword extends I_Keyword_PayLoad, I_GenericDocument { }

export interface I_QueryKeyword extends I_Keyword { }

export interface I_MutateKeyword extends Omit<I_Keyword, 'id' | 'createdAt' | 'updatedAt'> { }
