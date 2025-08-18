import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

import type { I_User } from '#modules/user/index.js';

export enum E_LegalDocumentType {
    TERM_AND_CONDITION = 'TERM_AND_CONDITION',
    PRIVACY_POLICY = 'PRIVACY_POLICY',
    COOKIE_POLICY = 'COOKIE_POLICY',
    CODE_OF_ETHICS = 'CODE_OF_ETHICS',
    TERM_OF_SALE = 'TERM_OF_SALE',
}

export enum E_LegalDocumentStatus {
    DRAFT = 'DRAFT',
    PUBLISHED = 'PUBLISHED',
}

export interface I_LegalDocumentHistory {
    type?: E_LegalDocumentType;
    content?: string;
    version?: number;
    updatedAt?: Date;
    updatedById?: string;
    updatedBy?: I_User;
}

export type T_LegalDocumentHistory_Populate = 'updatedBy';

export interface I_Input_QueryLegalDocumentHistory extends Omit<I_LegalDocumentHistory, T_LegalDocumentHistory_Populate> { }

export interface I_Input_MutateLegalDocumentHistory extends Required<Omit<I_LegalDocumentHistory, T_LegalDocumentHistory_Populate>> { }

export interface I_LegalDocument extends I_GenericDocument {
    type?: E_LegalDocumentType;
    content?: string;
    status?: E_LegalDocumentStatus;
    version?: number;
    history?: I_LegalDocumentHistory[];
}

export interface I_Input_QueryLegalDocument extends I_LegalDocument {
    history?: I_Input_QueryLegalDocumentHistory[];
}

export interface I_Input_CreateLegalDocument extends Omit<I_LegalDocument, T_Omit_Create> {
    type: E_LegalDocumentType;
    content: string;
    history?: I_Input_MutateLegalDocumentHistory[];
}

export interface I_Input_UpdateLegalDocument extends Omit<I_LegalDocument, T_Omit_Update> {
    history?: I_Input_MutateLegalDocumentHistory[];
}

export interface I_Input_SaveDraftLegalDocument {
    type: E_LegalDocumentType;
    content: string;
}

export interface I_Input_PublishLegalDocument {
    type: E_LegalDocumentType;
}

export interface I_Input_RestoreLegalDocument {
    id: string;
    version: number;
}
