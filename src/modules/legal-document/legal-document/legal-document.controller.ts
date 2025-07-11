import type { I_Input_CreateOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type {
    I_Input_PublishLegalDocument,
    I_Input_QueryLegalDocument,
    I_Input_RestoreLegalDocument,
    I_Input_SaveDraftLegalDocument,
    I_LegalDocument,
    I_LegalDocumentHistory,
} from './legal-document.type.js';

import { LegalDocumentModel } from './legal-document.model.js';
import { E_LegalDocumentStatus } from './legal-document.type.js';

const mongooseCtr = new MongooseController<I_LegalDocument>(LegalDocumentModel);

export const legalDocumentCtr = {
    getLegalDocument: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryLegalDocument>,
    ): Promise<I_Return<I_LegalDocument>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    getLegalDocuments: async (
        _context: I_Context,
        { filter, options }: I_Input_FindPaging<I_Input_QueryLegalDocument>,
    ): Promise<I_Return<T_PaginateResult<I_LegalDocument>>> => {
        return mongooseCtr.findPaging(filter, options);
    },
    createLegalDocument: async (context: I_Context, { doc }: I_Input_CreateOne<I_Input_SaveDraftLegalDocument>): Promise<I_Return<I_LegalDocument>> => {
        const existing = await legalDocumentCtr.getLegalDocument(context, { filter: { type: doc.type } });

        if (existing.success && existing.result) {
            throwError({
                message: 'Legal document already exists.',
                status: RESPONSE_STATUS.BAD_REQUEST,
            });
        }
        return mongooseCtr.createOne(doc);
    },
    updateLegalDocument: async (_context: I_Context, { filter, update, options }: I_Input_UpdateOne<I_Input_PublishLegalDocument>): Promise<I_Return<I_LegalDocument>> => {
        return mongooseCtr.updateOne(filter, update, options);
    },
    saveDraftLegalDocument: async (context: I_Context, { doc }: { doc: I_Input_SaveDraftLegalDocument }): Promise<I_Return<I_LegalDocument>> => {
        const { type, content } = doc;

        if (!content || !type) {
            throwError({ message: 'Content and type are required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const legalDocumentFound = await legalDocumentCtr.getLegalDocument(context, { filter: { type } });

        if (!legalDocumentFound.success) {
            return legalDocumentCtr.createLegalDocument(context, { doc });
        }

        const existingLegalDocument = legalDocumentFound.result;

        if (existingLegalDocument.status === E_LegalDocumentStatus.PUBLISHED) {
            throwError({ message: 'Cannot edit published document. Please restore or create a draft.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        if (existingLegalDocument.content === content) {
            throwError({ message: 'Content must be different from previous version.', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        let newVersion = existingLegalDocument.version || 1;

        if (existingLegalDocument.content !== content) {
            newVersion += 1;
        }

        return legalDocumentCtr.updateLegalDocument(context, {
            filter: { id: existingLegalDocument.id },
            update: {
                content,
                version: newVersion,
                updatedAt: new Date(),
            },
        });
    },
    publishLegalDocument: async (context: I_Context, { doc }: { doc: I_Input_PublishLegalDocument }): Promise<I_Return<I_LegalDocument>> => {
        const user = await authnCtr.getUserFromSession(context);

        const { type } = doc;

        if (!type) {
            throwError({ message: 'Type is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        const legalDocumentFound = await legalDocumentCtr.getLegalDocument(context, { filter: { type } });

        if (!legalDocumentFound.success) {
            throwError({ message: 'Document not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const legalDocument = legalDocumentFound.result;

        if (legalDocument.status === E_LegalDocumentStatus.PUBLISHED) {
            throwError({ message: 'Document is already published', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        let alreadyInHistory = false;

        if ((legalDocument.history || []).some((h: I_LegalDocumentHistory) => h.version === legalDocument.version && h.content === legalDocument.content)) {
            alreadyInHistory = true;
        }

        let newHistory = legalDocument.history || [];

        if (!alreadyInHistory) {
            newHistory = [
                ...newHistory,
                {
                    type: legalDocument.type,
                    content: legalDocument.content,
                    version: legalDocument.version,
                    updatedAt: new Date(),
                    updatedById: user.id,
                },
            ];
        }

        return legalDocumentCtr.updateLegalDocument(
            context,
            {
                filter: { id: legalDocument.id },
                update: {
                    status: E_LegalDocumentStatus.PUBLISHED,
                    updatedAt: new Date(),
                    history: newHistory,
                },
            },
        );
    },
    restoreLegalDocument: async (context: I_Context, { doc }: { doc: I_Input_RestoreLegalDocument }): Promise<I_Return<I_LegalDocument>> => {
        const user = await authnCtr.getUserFromSession(context);

        const { id, version } = doc;

        const legalDocumentFound = await legalDocumentCtr.getLegalDocument(context, { filter: { id } });

        if (!legalDocumentFound.success) {
            throwError({ message: 'Document not found', status: RESPONSE_STATUS.NOT_FOUND });
        }
        const legalDocument = legalDocumentFound.result;

        const history = (legalDocument.history || []).find((h: I_LegalDocumentHistory) => h.version === version);

        if (!history) {
            throwError({ message: 'Version not found in history', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const newHistory = [
            ...(legalDocument.history || []),
            {
                type: legalDocument.type,
                content: history.content,
                version: history.version,
                updatedAt: new Date(),
                updatedById: user.id,
            },
        ];

        return legalDocumentCtr.updateLegalDocument(
            context,
            {
                filter: { id: legalDocument.id },
                update: {
                    content: legalDocument.content,
                    version: legalDocument.version,
                    status: E_LegalDocumentStatus.PUBLISHED,
                    updatedAt: new Date(),
                    history: newHistory,
                },
            },
        );
    },
};
