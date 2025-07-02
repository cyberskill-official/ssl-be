import type { I_Input_CreateOne, I_Input_FindOne, I_Input_FindPaging, I_Input_UpdateOne, T_PaginateResult } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

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
        // 1. Ensure the user is authenticated
        const userId = context.req?.session?.user?.id;

        if (!userId) {
            throwError({ message: 'Unauthenticated', status: RESPONSE_STATUS.UNAUTHORIZED });
        }
        // 2. Validate required input
        if (!content || !type) {
            throwError({ message: 'Content and type are required', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        // 3. Find existing document by type
        const legalDocumentFound = await legalDocumentCtr.getLegalDocument(context, { filter: { type } });
        // 4. If not found, create a new draft document (version 1, status DRAFT, empty history)
        if (!legalDocumentFound.success) {
            return legalDocumentCtr.createLegalDocument(context, { doc });
        }
        // 5. If found, only allow edits if status is DRAFT
        const existingLegalDocument = legalDocumentFound.result;
        if (existingLegalDocument.status === E_LegalDocumentStatus.PUBLISHED) {
            throwError({ message: 'Cannot edit published document. Please restore or create a draft.', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        // 6. Content must be different from previous
        if (existingLegalDocument.content === content) {
            throwError({ message: 'Content must be different from previous version.', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        // 7. Auto-increment version only if content changed
        let newVersion = existingLegalDocument.version || 1;
        if (existingLegalDocument.content !== content) {
            newVersion += 1;
        }
        // 8. Update the draft document with new content, version, and updatedAt
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
        const { type } = doc;
        // 1. Ensure the user is authenticated
        const userId = context.req?.session?.user?.id;

        if (!userId) {
            throwError({ message: 'Unauthenticated', status: RESPONSE_STATUS.UNAUTHORIZED });
        }
        // 2. Validate required input
        if (!type) {
            throwError({ message: 'Type is required', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        // 3. Find the draft document by type
        const legalDocumentFound = await legalDocumentCtr.getLegalDocument(context, { filter: { type } });

        if (!legalDocumentFound.success) {
            throwError({ message: 'Document not found', status: RESPONSE_STATUS.NOT_FOUND });
        }

        const legalDocument = legalDocumentFound.result;
        // 4. Only allow publishing if the document is in DRAFT status
        if (legalDocument.status === E_LegalDocumentStatus.PUBLISHED) {
            throwError({ message: 'Document is already published', status: RESPONSE_STATUS.BAD_REQUEST });
        }
        // 5. Check if the current version/content is already in history
        let alreadyInHistory = false;
        if ((legalDocument.history || []).some((h: I_LegalDocumentHistory) => h.version === legalDocument.version && h.content === legalDocument.content)) {
            alreadyInHistory = true;
        }
        // 6. If not in history, add the current version/content to history
        let newHistory = legalDocument.history || [];

        if (!alreadyInHistory) {
            newHistory = [
                ...newHistory,
                {
                    type: legalDocument.type,
                    content: legalDocument.content,
                    version: legalDocument.version,
                    updatedAt: new Date(),
                    updatedById: userId,
                },
            ];
        }
        // 7. Update the document: set status to PUBLISHED, update updatedAt, and update history
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
        const { id, version } = doc;
        // 1. Ensure the user is authenticated
        const userId = context.req?.session?.user?.id;

        if (!userId) {
            throwError({ message: 'Unauthenticated', status: RESPONSE_STATUS.UNAUTHORIZED });
        }
        // 2. Find the document by id
        const legalDocumentFound = await legalDocumentCtr.getLegalDocument(context, { filter: { id } });
        if (!legalDocumentFound.success) {
            throwError({ message: 'Document not found', status: RESPONSE_STATUS.NOT_FOUND });
        }
        const legalDocument = legalDocumentFound.result;
        // 3. Find the requested version in the document's history
        const history = (legalDocument.history || []).find((h: I_LegalDocumentHistory) => h.version === version);
        if (!history) {
            throwError({ message: 'Version not found in history', status: RESPONSE_STATUS.NOT_FOUND });
        }
        // 4. Add a new history entry for the restore action
        const newHistory = [
            ...(legalDocument.history || []),
            {
                type: legalDocument.type,
                content: history.content,
                version: history.version,
                updatedAt: new Date(),
                updatedById: userId,
            },
        ];
        // 5. Update the document: set content/version to the restored version, set status to PUBLISHED, update updatedAt, and update history
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
