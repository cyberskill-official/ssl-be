import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

export interface I_Language_PayLoad {
    code?: string;
    name?: string;
    native?: string;
    isRTL?: boolean;
}

export interface I_Language extends I_Language_PayLoad, I_GenericDocument { }

export interface I_QueryLanguage extends I_Language { }

export interface I_MutateLanguage extends Omit<I_Language, 'id' | 'createdAt' | 'updatedAt'> { }
