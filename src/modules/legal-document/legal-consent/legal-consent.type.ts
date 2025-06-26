import type { I_GenericDocument } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

import type { I_LegalDocument } from '../legal-document/index.js';

export interface I_LegalConsent extends I_GenericDocument {
    legalDocumentId?: string;
    legalDocument?: I_LegalDocument;
    userId?: string;
    user?: I_User;
    version?: number;
}

export type T_LegalConsent_Populate = 'legalDocument' | 'user';

export interface I_Input_QueryLegalConsent extends Omit<I_LegalConsent, T_LegalConsent_Populate> { }

export interface I_Input_CreateLegalConsent {
    legalDocumentId: string;
    version: number;
}
