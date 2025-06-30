import type { I_GenericDocument, T_Omit_Create, T_Omit_Update } from '@cyberskill/shared/node/mongo';

export interface I_EmailTemplate extends I_GenericDocument {
    templateKey?: string;
    name?: string;
    subject?: string;
    content?: string;
    variables?: string[];
}

export interface I_Input_QueryEmailTemplate extends I_EmailTemplate { }

export interface I_Input_CreateEmailTemplate extends Omit<I_EmailTemplate, T_Omit_Create> {
    templateKey: string;
    name: string;
    subject: string;
    content: string;
}

export interface I_Input_UpdateEmailTemplate extends Omit<I_EmailTemplate, T_Omit_Update> { }
