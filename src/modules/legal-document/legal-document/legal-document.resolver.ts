import type { I_Input_CreateOne, I_Input_FindOne, I_Input_FindPaging } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import type { I_Input_PublishLegalDocument, I_Input_QueryLegalDocument, I_Input_RestoreLegalDocument, I_Input_SaveDraftLegalDocument } from './legal-document.type.js';

import { legalDocumentCtr } from './legal-document.controller.js';

const legalDocumentResolver = {
    Query: {
        getLegalDocument: (_parent: unknown, args: I_Input_FindOne<I_Input_QueryLegalDocument>, context: I_Context) => legalDocumentCtr.getLegalDocument(context, args),
        getLegalDocuments: (_parent: unknown, args: I_Input_FindPaging<I_Input_QueryLegalDocument>, context: I_Context) => legalDocumentCtr.getLegalDocuments(context, args),
    },
    Mutation: {
        saveDraftLegalDocument: (_parent: unknown, args: I_Input_CreateOne<I_Input_SaveDraftLegalDocument>, context: I_Context) => legalDocumentCtr.saveDraftLegalDocument(context, args),
        publishLegalDocument: (_parent: unknown, args: I_Input_CreateOne<I_Input_PublishLegalDocument>, context: I_Context) => legalDocumentCtr.publishLegalDocument(context, args),
        restoreLegalDocument: (_parent: unknown, args: I_Input_CreateOne<I_Input_RestoreLegalDocument>, context: I_Context) => legalDocumentCtr.restoreLegalDocument(context, args),
    },
};

export default legalDocumentResolver;
