import type { I_Input_FindOne } from '@cyberskill/shared/node/mongo';
import type { I_Return } from '@cyberskill/shared/typescript';

import { RESPONSE_STATUS } from '@cyberskill/shared/constant';
import { throwError } from '@cyberskill/shared/node/log';
import { MongooseController } from '@cyberskill/shared/node/mongo';

import type { I_Context } from '#shared/typescript/index.js';

import { authnCtr } from '#modules/authn/index.js';

import type { I_LegalDocument } from '../legal-document/legal-document.type.js';
import type { I_Input_CreateLegalConsent, I_Input_QueryLegalConsent, I_LegalConsent } from './legal-consent.type.js';

import { E_LegalDocumentStatus, legalDocumentCtr } from '../legal-document/index.js';
import { LegalConsentModel } from './legal-consent.model.js';

const mongooseCtr = new MongooseController<I_LegalConsent>(LegalConsentModel);

export const legalConsentCtr = {
    getLegalConsent: async (
        _context: I_Context,
        { filter, projection, options, populate }: I_Input_FindOne<I_Input_QueryLegalConsent>,
    ): Promise<I_Return<I_LegalConsent>> => {
        return mongooseCtr.findOne(filter, projection, options, populate);
    },
    checkLegalConsents: async (context: I_Context): Promise<I_Return<I_LegalDocument[]>> => {
        const userId = await authnCtr.getUserFromSession(context);

        const legalDocumentsFound = await legalDocumentCtr.getLegalDocuments(context, {
            filter: {
                status: E_LegalDocumentStatus.PUBLISHED,
            },
        });

        if (!legalDocumentsFound.success) {
            throwError({ message: 'Failed to get legal documents', status: RESPONSE_STATUS.INTERNAL_SERVER_ERROR });
        }

        const docsToConsent: I_LegalDocument[] = [];

        for (const doc of legalDocumentsFound.result.docs) {
            if (typeof doc.version !== 'number') {
                continue;
            }

            const consentResult = await legalConsentCtr.getLegalConsent(context, {
                filter: {
                    userId,
                    legalDocumentId: doc.id,
                    version: doc.version,
                },
            });

            if (!consentResult.success) {
                docsToConsent.push(doc);
            }
        }

        return {
            success: true,
            result: docsToConsent,
        };
    },
    createLegalConsent: async (context: I_Context, { doc }: { doc: I_Input_CreateLegalConsent }) => {
        const user = await authnCtr.getUserFromSession(context);

        const { legalDocumentId, version } = doc;
        const legalConsentFound = await legalConsentCtr.getLegalConsent(context, {
            filter: {
                userId: user.id,
                legalDocumentId,
                version,
            },
        });

        if (legalConsentFound.success) {
            throwError({ message: 'Already consented to this version', status: RESPONSE_STATUS.BAD_REQUEST });
        }

        return mongooseCtr.createOne({ ...doc, userId: user.id });
    },
};
